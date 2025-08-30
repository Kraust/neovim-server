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
	nvim       *nvim.Nvim
	conn       *websocket.Conn
	address    string
	active     bool
	uiAttached bool
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

func (ctx *Server) listenToNeovimEvents(session *ClientSession) error {
	session.nvim.RegisterHandler("redraw", func(updates ...[]any) {
		if !session.active {
			return
		}
		for _, update := range updates {
			message := map[string]any{
				"type": "redraw",
				"data": update,
			}
			ctx.sendToClient(session, message)
		}
	})

	if err := session.nvim.Subscribe("redraw"); err != nil {
		return fmt.Errorf("failed to subscribe to redraw events: %w", err)
	}

	err := session.nvim.Serve()

	log.Printf("Neovim session closed for client")

	session.active = false
	session.uiAttached = false // Reset UI state
	ctx.sendToClient(session, map[string]any{
		"type": "session_closed",
		"data": "Neovim session has been closed",
	})

	return err
}

func (ctx *Server) sendToClient(session *ClientSession, message map[string]any) {
	if !session.active && message["type"] != "session_closed" {
		return
	}

	err := session.conn.WriteJSON(message)
	if err != nil {
		log.Printf("Write error to client: %v", err)
		session.active = false
		session.conn.Close()
	}
}

func (ctx *Server) handleClientMessage(session *ClientSession, msg map[string]any) {
	switch msg["type"] {
	case "connect":
		address, ok := msg["address"].(string)
		if !ok {
			ctx.sendToClient(session, map[string]any{
				"type": "error",
				"data": "Invalid server address",
			})
			return
		}

		if err := ctx.connectSessionToNeovim(session, address); err != nil {
			log.Printf("Failed to connect client to Neovim at %s: %v", address, err)
			ctx.sendToClient(session, map[string]any{
				"type": "error",
				"data": fmt.Sprintf("Failed to connect to Neovim: %v", err),
			})
			return
		}

		ctx.sendToClient(session, map[string]any{
			"type": "connected",
			"data": "Successfully connected to Neovim",
		})
	default:
		// Only handle other messages if this session has Neovim connected
		if !session.active || session.nvim == nil {
			ctx.sendToClient(session, map[string]any{
				"type": "error",
				"data": "Not connected to Neovim",
			})
			return
		}

		ctx.handleNeovimCommand(session, msg)
	}
}

func (ctx *Server) handleNeovimCommand(session *ClientSession, msg map[string]any) {
	// Check if session is still active
	if !session.active || session.nvim == nil {
		ctx.sendToClient(session, map[string]any{
			"type": "error",
			"data": "Neovim session is no longer active",
		})
		return
	}

	switch msg["type"] {
	case "attach_ui":
		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		options := map[string]any{
			"ext_linegrid":  true,
			"ext_multigrid": false,
			"rgb":           true,
		}
		if err := session.nvim.AttachUI(width, height, options); err != nil {
			log.Printf("Error attaching UI: %v", err)
			session.uiAttached = false
			if strings.Contains(err.Error(), "session closed") {
				session.active = false
				ctx.sendToClient(session, map[string]any{
					"type": "session_closed",
					"data": "Neovim session has been closed",
				})
			}
		} else {
			session.uiAttached = true
			log.Printf("UI attached successfully for client")
		}
	case "input":
		// Forward keyboard input to Neovim
		input := msg["data"].(string)
		if _, err := session.nvim.Input(input); err != nil {
			log.Printf("Error sending input: %v", err)
			if strings.Contains(err.Error(), "session closed") {
				session.active = false
				ctx.sendToClient(session, map[string]any{
					"type": "session_closed",
					"data": "Neovim session has been closed",
				})
			}
		}
	case "command":
		// Execute Neovim command
		cmd := msg["data"].(string)

		// Check if this is a UI attach command
		if strings.Contains(cmd, "nvim_ui_attach") {
			// Extract dimensions and call AttachUI directly
			if err := session.nvim.AttachUI(80, 24, map[string]any{
				"ext_linegrid":  true,
				"ext_multigrid": false,
				"rgb":           true,
			}); err != nil {
				log.Printf("Error attaching UI: %v", err)
			}
		} else if after, ok := strings.CutPrefix(cmd, "lua "); ok {
			// Handle other Lua commands
			luaCode := after
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
		if !session.uiAttached {
			return
		}

		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		if err := session.nvim.TryResizeUI(width, height); err != nil {
			log.Printf("Error resizing UI: %v", err)
			if strings.Contains(err.Error(), "UI not attached") {
				session.uiAttached = false
				log.Printf("UI detached, ignoring future resize requests until reattached")
			} else if strings.Contains(err.Error(), "session closed") {
				session.active = false
				session.uiAttached = false
				ctx.sendToClient(session, map[string]any{
					"type": "session_closed",
					"data": "Neovim session has been closed",
				})
			}
		}
	case "mouse":
		action := msg["action"].(string)
		button := int(msg["button"].(float64))
		row := int(msg["row"].(float64))
		col := int(msg["col"].(float64))

		var input string
		switch button {
		case 0: // Left button
			switch action {
			case "press":
				input = fmt.Sprintf("<LeftMouse><%d,%d>", col, row)
			case "drag":
				input = fmt.Sprintf("<LeftDrag><%d,%d>", col, row)
			default:
				input = fmt.Sprintf("<LeftRelease><%d,%d>", col, row)
			}
		case 2: // Right button
			switch action {
			case "press":
				input = fmt.Sprintf("<RightMouse><%d,%d>", col, row)
			case "drag":
				input = fmt.Sprintf("<RightDrag><%d,%d>", col, row)
			default:
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

func (ctx *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := ctx.upgrader.Upgrade(w, r, nil)
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

	ctx.mu.Lock()
	ctx.clients[conn] = session
	ctx.mu.Unlock()

	defer func() {
		ctx.mu.Lock()
		if session.nvim != nil {
			session.nvim.Close()
		}
		delete(ctx.clients, conn)
		ctx.mu.Unlock()
	}()

	// Send connection ready message
	conn.WriteJSON(map[string]any{
		"type": "ready",
		"data": "WebSocket connected. Please provide Neovim server addresctx.",
	})

	// Handle incoming messages
	for {
		var msg map[string]any
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("Read error: %v", err)
			break
		}

		ctx.handleClientMessage(session, msg)
	}
}

func (ctx *Server) connectSessionToNeovim(session *ClientSession, address string) error {
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
		if err := ctx.listenToNeovimEvents(session); err != nil {
			log.Printf("Error in Neovim event listener for client: %v", err)
		}
	}()

	return nil
}

func (ctx *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx.mu.RLock()
	activeClients := 0
	for _, session := range ctx.clients {
		if session.active {
			activeClients++
		}
	}
	totalClients := len(ctx.clients)
	ctx.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"status": "running", "total_clients": %d, "active_clients": %d}`, totalClients, activeClients)
}
