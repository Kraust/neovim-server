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
)

//go:embed static/*
var staticFiles embed.FS

type Server struct {
	nvim     *nvim.Nvim
	upgrader websocket.Upgrader
	clients  map[*websocket.Conn]bool
}

func Serve(address string) error {
	ctx := &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients: make(map[*websocket.Conn]bool),
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

func (ctx *Server) connectToNeovimWithAddress(address string) error {
	// Close existing connection if any
	if ctx.nvim != nil {
		log.Printf("Closing existing Neovim connection")
		ctx.nvim.Close()
		ctx.nvim = nil
	}

	log.Printf("Dialing Neovim at address: %s", address)
	// Connect to Neovim instance at specified address
	client, err := nvim.Dial(address)
	if err != nil {
		return fmt.Errorf("failed to dial %s: %w", address, err)
	}
	ctx.nvim = client
	log.Printf("Successfully dialed Neovim")

	// Start event listener in a separate goroutine to avoid blocking
	go func() {
		if err := ctx.listenToNeovimEvents(); err != nil {
			log.Printf("Error in Neovim event listener: %v", err)
		}
	}()

	return nil
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

func (ctx *Server) listenToNeovimEvents() error {
	// Register handler for UI events
	ctx.nvim.RegisterHandler("redraw", func(updates ...[]interface{}) {
		// Broadcast redraw events to all connected clients
		for _, update := range updates {
			message := map[string]interface{}{
				"type": "redraw",
				"data": update,
			}
			ctx.broadcastToClients(message)
		}
	})

	// Subscribe to UI events
	if err := ctx.nvim.Subscribe("redraw"); err != nil {
		return fmt.Errorf("failed to subscribe to redraw events: %w", err)
	}

	// Serve the event loop (this blocks)
	return ctx.nvim.Serve()
}

func (ctx *Server) handleClientMessage(msg map[string]interface{}) {
	log.Printf("Received message: %v", msg)
	switch msg["type"] {
	case "attach_ui":
		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		options := map[string]interface{}{
			"ext_linegrid":  true,
			"ext_multigrid": false,
			"rgb":           true,
		}
		if err := ctx.nvim.AttachUI(width, height, options); err != nil {
			log.Printf("Error attaching UI: %v", err)
		} else {
			log.Printf("UI attached successfully with dimensions %dx%d", width, height)
		}
	case "input":
		// Forward keyboard input to Neovim
		input := msg["data"].(string)
		if _, err := ctx.nvim.Input(input); err != nil {
			log.Printf("Error sending input: %v", err)
		}
	case "command":
		// Execute Neovim command
		cmd := msg["data"].(string)
		log.Printf("Executing command: %s", cmd)

		// Check if this is a UI attach command
		if strings.Contains(cmd, "nvim_ui_attach") {
			// Extract dimensions and call AttachUI directly
			if err := ctx.nvim.AttachUI(80, 24, map[string]interface{}{
				"ext_linegrid":  true,
				"ext_multigrid": false,
				"rgb":           true,
			}); err != nil {
				log.Printf("Error attaching UI: %v", err)
			} else {
				log.Printf("UI attached successfully")
			}
		} else if strings.HasPrefix(cmd, "lua ") {
			// Handle other Lua commands
			luaCode := strings.TrimPrefix(cmd, "lua ")
			if err := ctx.nvim.ExecLua(luaCode, nil); err != nil {
				log.Printf("Error executing Lua: %v", err)
			}
		} else {
			// Handle regular commands
			if err := ctx.nvim.Command(cmd); err != nil {
				log.Printf("Error executing command: %v", err)
			}
		}
	case "resize":
		// Handle terminal resize
		width := int(msg["width"].(float64))
		height := int(msg["height"].(float64))
		if err := ctx.nvim.TryResizeUI(width, height); err != nil {
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
			if _, err := ctx.nvim.Input(input); err != nil {
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

		if _, err := ctx.nvim.Input(input); err != nil {
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

	ctx.clients[conn] = true
	defer delete(ctx.clients, conn)

	log.Printf("Client connected. Total clients: %d", len(ctx.clients))

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

		// Handle connect message with server address
		if msg["type"] == "connect" {
			address, ok := msg["address"].(string)
			if !ok {
				conn.WriteJSON(map[string]interface{}{
					"type": "error",
					"data": "Invalid server address",
				})
				continue
			}

			if err := ctx.connectToNeovimWithAddress(address); err != nil {
				log.Printf("Failed to connect to Neovim at %s: %v", address, err)
				conn.WriteJSON(map[string]interface{}{
					"type": "error",
					"data": fmt.Sprintf("Failed to connect to Neovim: %v", err),
				})
				continue
			}

			conn.WriteJSON(map[string]interface{}{
				"type": "connected",
				"data": "Successfully connected to Neovim",
			})
			continue
		}

		// Only handle other messages if Neovim is connected
		if ctx.nvim == nil {
			conn.WriteJSON(map[string]interface{}{
				"type": "error",
				"data": "Not connected to Neovim",
			})
			continue
		}

		ctx.handleClientMessage(msg)
	}
}

func (ctx *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status": "connected", "clients": ` +
		fmt.Sprintf("%d", len(ctx.clients)) + `}`))
}
