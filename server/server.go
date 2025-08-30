package server

import (
	"embed"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/neovim/go-client/nvim"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
)

//go:embed static/*
var staticFiles embed.FS

type ClientSession struct {
	nvim    *nvim.Nvim
	conn    *websocket.Conn
	address string
	active  bool
}

type Server struct {
	upgrader websocket.Upgrader
	clients  map[*websocket.Conn]*ClientSession
	mu       sync.RWMutex
}

func Serve(address string) error {
	ctx := &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients: make(map[*websocket.Conn]*ClientSession),
	}

	// Serve embedded static files
	staticFS, _ := fs.Sub(staticFiles, "static")
	http.Handle("/", http.FileServer(http.FS(staticFS)))

	// WebSocket endpoint
	http.HandleFunc("/ws", ctx.handleWebSocket)

	// API endpoints (optional)
	http.HandleFunc("/api/status", ctx.handleStatus)

	log.Printf("Server starting on %s", address)

	err := http.ListenAndServe(address, nil)
	if err != nil {
		return err
	}

	return nil
}

func (s *Server) listenToNeovimEvents(session *ClientSession) error {
	// Register handler for UI events - specific to this session
	session.nvim.RegisterHandler("redraw", func(updates ...[]interface{}) {
		// Send redraw events only to this client
		for _, update := range updates {
			message := map[string]interface{}{
				"type": "redraw",
				"data": update,
			}
			s.sendToClient(session, message)
		}
	})

	// Subscribe to UI events
	if err := session.nvim.Subscribe("redraw"); err != nil {
		return fmt.Errorf("failed to subscribe to redraw events: %w", err)
	}

	// Serve the event loop (this blocks)
	return session.nvim.Serve()
}

func (s *Server) sendToClient(session *ClientSession, message map[string]interface{}) {
	err := session.conn.WriteJSON(message)
	if err != nil {
		log.Printf("Write error to client: %v", err)
		session.conn.Close()
		// Session cleanup will be handled by defer in handleWebSocket
	}
}

func (ctx *Server) broadcastToClients(message map[string]interface{}) {
	for client := range ctx.clients {
		err := client.WriteJSON(message)
		if err != nil {
			log.Printf("Write error: %v", err)
			client.Close()
			delete(ctx.clients, client)
		}
	}
}

func (s *Server) handleClientMessage(session *ClientSession, msg map[string]interface{}) {
	switch msg["type"] {
	case "connect":
		address, ok := msg["address"].(string)
		if !ok {
			s.sendToClient(session, map[string]interface{}{
				"type": "error",
				"data": "Invalid server address",
			})
			return
		}

		if err := s.connectSessionToNeovim(session, address); err != nil {
			log.Printf("Failed to connect client to Neovim at %s: %v", address, err)
			s.sendToClient(session, map[string]interface{}{
				"type": "error",
				"data": fmt.Sprintf("Failed to connect to Neovim: %v", err),
			})
			return
		}

		s.sendToClient(session, map[string]interface{}{
			"type": "connected",
			"data": "Successfully connected to Neovim",
		})

	default:
		// Only handle other messages if this session has Neovim connected
		if !session.active || session.nvim == nil {
			s.sendToClient(session, map[string]interface{}{
				"type": "error",
				"data": "Not connected to Neovim",
			})
			return
		}

		s.handleNeovimCommand(session, msg)
	}
}

func (ctx *Server) handleNeovimCommand(session *ClientSession, msg map[string]interface{}) {
	switch msg["type"] {
	case "attach_ui":
		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		options := map[string]interface{}{
			"ext_linegrid":  true,
			"ext_multigrid": false,
			"rgb":           true,
		}
		if err := session.nvim.AttachUI(width, height, options); err != nil {
			log.Printf("Error attaching UI: %v", err)
		}
	case "input":
		// Forward keyboard input to Neovim
		input := msg["data"].(string)
		if _, err := session.nvim.Input(input); err != nil {
			log.Printf("Error sending input: %v", err)
		}
	case "command":
		// Execute Neovim command
		cmd := msg["data"].(string)

		// Check if this is a UI attach command
		if strings.Contains(cmd, "nvim_ui_attach") {
			// Extract dimensions and call AttachUI directly
			if err := session.nvim.AttachUI(80, 24, map[string]interface{}{
				"ext_linegrid":  true,
				"ext_multigrid": false,
				"rgb":           true,
			}); err != nil {
				log.Printf("Error attaching UI: %v", err)
			}
		} else if strings.HasPrefix(cmd, "lua ") {
			// Handle other Lua commands
			luaCode := strings.TrimPrefix(cmd, "lua ")
			if err := session.nvim.ExecLua(luaCode, nil); err != nil {
				log.Printf("Error executing Lua: %v", err)
			}
		} else {
			// Handle regular commands
			if err := session.nvim.Command(cmd); err != nil {
				log.Printf("Error executing command: %v", err)
			}
		}
	case "resize":
		// Handle terminal resize
		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		if err := session.nvim.TryResizeUI(width, height); err != nil {
			log.Printf("Error resizing UI: %v", err)
		}
	case "mouse":
		action := msg["action"].(string)
		button := int(msg["button"].(float64))
		row := int(msg["row"].(float64))
		col := int(msg["col"].(float64))

		var input string
		switch button {
		case 0: // Left button
			if action == "press" {
				input = fmt.Sprintf("<LeftMouse><%d,%d>", col, row)
			} else if action == "drag" {
				input = fmt.Sprintf("<LeftDrag><%d,%d>", col, row)
			} else {
				input = fmt.Sprintf("<LeftRelease><%d,%d>", col, row)
			}
		case 2: // Right button
			if action == "press" {
				input = fmt.Sprintf("<RightMouse><%d,%d>", col, row)
			} else if action == "drag" {
				input = fmt.Sprintf("<RightDrag><%d,%d>", col, row)
			} else {
				input = fmt.Sprintf("<RightRelease><%d,%d>", col, row)
			}
		}

		if input != "" {
			if _, err := session.nvim.Input(input); err != nil {
				log.Printf("Error sending mouse input: %v", err)
			}
		}
	case "scroll":
		direction := msg["direction"].(string)
		row := int(msg["row"].(float64))
		col := int(msg["col"].(float64))

		var input string
		if direction == "up" {
			input = fmt.Sprintf("<ScrollWheelUp><%d,%d>", col, row)
		} else {
			input = fmt.Sprintf("<ScrollWheelDown><%d,%d>", col, row)
		}

		if _, err := session.nvim.Input(input); err != nil {
			log.Printf("Error sending scroll input: %v", err)
		}

	}

}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Create new client session
	session := &ClientSession{
		conn:   conn,
		active: false,
	}

	s.mu.Lock()
	s.clients[conn] = session
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		if session.nvim != nil {
			session.nvim.Close()
		}
		delete(s.clients, conn)
		s.mu.Unlock()
	}()

	// Send connection ready message
	conn.WriteJSON(map[string]interface{}{
		"type": "ready",
		"data": "WebSocket connected. Please provide Neovim server address.",
	})

	// Handle incoming messages
	for {
		var msg map[string]interface{}
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("Read error: %v", err)
			break
		}

		s.handleClientMessage(session, msg)
	}
}

func (s *Server) connectSessionToNeovim(session *ClientSession, address string) error {
	// Close existing connection if any
	if session.nvim != nil {
		session.nvim.Close()
		session.nvim = nil
	}

	client, err := nvim.Dial(address)
	if err != nil {
		return fmt.Errorf("failed to dial %s: %w", address, err)
	}

	session.nvim = client
	session.address = address
	session.active = true
	log.Printf("Successfully connected client to Neovim at %s", address)

	// Start event listener for this session
	go func() {
		if err := s.listenToNeovimEvents(session); err != nil {
			log.Printf("Error in Neovim event listener for client: %v", err)
		}
	}()

	return nil
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	activeClients := 0
	for _, session := range s.clients {
		if session.active {
			activeClients++
		}
	}
	totalClients := len(s.clients)
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(fmt.Sprintf(`{"status": "running", "total_clients": %d, "active_clients": %d}`, totalClients, activeClients)))
}
