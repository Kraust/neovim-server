class NeovimRenderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.cellWidth = 12;
		this.cellHeight = 20;
		this.rows = 24;
		this.cols = 80;
		this.grid = [];
		this.cursor = { row: 0, col: 0 };
		this.colors = {
			fg: "#ffffff",
			bg: "#000000",
		};
		this.highlights = new Map(); // Store highlight definitions

		this.initGrid();
		this.setupCanvas();
	}

	initGrid() {
		this.grid = Array(this.rows)
			.fill()
			.map(() =>
				Array(this.cols)
					.fill()
					.map(() => ({
						char: " ",
						fg: this.colors.fg,
						bg: this.colors.bg,
					})),
			);
	}

	setupCanvas() {
		this.canvas.width = this.cols * this.cellWidth;
		this.canvas.height = this.rows * this.cellHeight;
		this.ctx.font = `${this.cellHeight - 4}px monospace`;
		this.ctx.textBaseline = "top";
		this.clear();
	}

	clear() {
		this.ctx.fillStyle = this.colors.bg;
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	drawCell(row, col, cell) {
		const x = col * this.cellWidth;
		const y = row * this.cellHeight;

		// Draw background
		this.ctx.fillStyle = cell.bg;
		this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

		// Draw character
		if (cell.char && cell.char !== " ") {
			this.ctx.fillStyle = cell.fg;
			this.ctx.fillText(cell.char, x + 2, y + 2);
		}
	}

	drawCursor() {
		const x = this.cursor.col * this.cellWidth;
		const y = this.cursor.row * this.cellHeight;

		this.ctx.fillStyle = "#ffffff";
		this.ctx.fillRect(x, y + this.cellHeight - 2, this.cellWidth, 2);
	}

	handleRedrawEvent(event) {
		console.log("Raw redraw event:", event);

		if (!Array.isArray(event) || event.length === 0) {
			console.log("Invalid event format:", event);
			return;
		}

		// The event structure is [eventType, ...eventData]
		const eventType = event[0];
		const eventData = event.slice(1);

		console.log("Event type:", eventType, "Data:", eventData);

		switch (eventType) {
			case "option_set":
				console.log("Option set:", eventData);
				break;
			case "grid_resize":
				console.log("Grid resize:", eventData);
				this.handleGridResize(eventData);
				break;
			case "grid_line":
				console.log("Grid line:", eventData);
				this.handleGridLine(eventData);
				break;
			case "grid_cursor_goto":
				console.log("Cursor goto:", eventData);
				this.handleCursorGoto(eventData);
				break;
			case "grid_clear":
				console.log("Grid clear");
				this.handleGridClear();
				break;
			case "default_colors_set":
				console.log("Default colors:", eventData);
				this.handleDefaultColors(eventData);
				break;
			case "flush":
				console.log("Flush event - redrawing");
				this.redraw();
				break;
			case "hl_attr_define":
				this.handleHlAttrDefine(eventData);
				break;
			case "hl_group_set":
				// Handle highlight group definitions if needed
				break;
			default:
				console.log("Unhandled event type:", eventType, eventData);
		}
	}

	handleHlAttrDefine(eventData) {
		for (const hlData of eventData) {
			const [id, rgbAttrs, ctermAttrs, info] = hlData;
			this.highlights.set(id, {
				fg: rgbAttrs.foreground
					? this.rgbToHex(rgbAttrs.foreground)
					: this.colors.fg,
				bg: rgbAttrs.background
					? this.rgbToHex(rgbAttrs.background)
					: this.colors.bg,
				bold: rgbAttrs.bold || false,
				italic: rgbAttrs.italic || false,
				underline: rgbAttrs.underline || false,
			});
		}
	}

	handleGridResize(args) {
		if (!args || args.length === 0) return;
		const [grid, width, height] = args[0] || args;
		console.log(
			"Grid resize - Grid:",
			grid,
			"Width:",
			width,
			"Height:",
			height,
		);

		if (grid === 1) {
			// Main grid
			this.cols = width;
			this.rows = height;
			this.initGrid();
			this.setupCanvas();
		}
	}

	handleGridLine(eventData) {
		if (!eventData || eventData.length === 0) return;

		// Each element in eventData is a line update: [grid, row, colStart, cells, wrap]
		for (const lineData of eventData) {
			if (!Array.isArray(lineData) || lineData.length < 4) continue;

			const [grid, row, colStart, cells, wrap] = lineData;

			if (grid !== 1) continue; // Only handle main grid
			if (row >= this.rows || row < 0) continue;

			let col = colStart;
			if (cells && Array.isArray(cells)) {
				for (const cellData of cells) {
					if (col >= this.cols) break;

					// Handle different cell data formats from Neovim
					let char, hlId, repeatCount;

					if (Array.isArray(cellData)) {
						char = cellData[0] || " ";
						hlId = cellData.length > 1 ? cellData[1] : 0;
						repeatCount = cellData.length > 2 ? cellData[2] : 1;
					} else {
						char = cellData || " ";
						hlId = 0;
						repeatCount = 1;
					}

					for (let i = 0; i < repeatCount && col < this.cols; i++) {
						const highlight = this.highlights.get(hlId) || {
							fg: this.colors.fg,
							bg: this.colors.bg,
						};
						this.grid[row][col] = {
							char: char,
							fg: highlight.fg,
							bg: highlight.bg,
						};
						col++;
					}
				}
			}
		}

		// Redraw after processing all lines
		this.redraw();
	}

	handleCursorGoto(args) {
		if (!args || args.length === 0) return;
		const [grid, row, col] = args[0] || args;
		console.log("Cursor goto - Grid:", grid, "Row:", row, "Col:", col);

		if (grid === 1) {
			this.cursor = { row, col };
			this.redraw();
		}
	}

	handleDefaultColors(args) {
		if (!args || args.length === 0) return;
		const [fg, bg] = args[0] || args;
		console.log("Default colors - FG:", fg, "BG:", bg);

		this.colors.fg = this.rgbToHex(fg);
		this.colors.bg = this.rgbToHex(bg);

		// Update canvas background immediately
		this.clear();
	}

	handleGridClear() {
		this.initGrid();
		this.clear();
	}

	rgbToHex(rgb) {
		if (rgb === undefined || rgb === null || rgb === -1) {
			return rgb === -1 ? "#000000" : "#ffffff";
		}
		// Ensure positive value and convert to hex
		const value = Math.abs(rgb);
		return "#" + value.toString(16).padStart(6, "0");
	}

	redraw() {
		this.clear();
		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				this.drawCell(row, col, this.grid[row][col]);
			}
		}
		this.drawCursor();
	}

	resize(width, height) {
		this.cols = Math.floor(width / this.cellWidth);
		this.rows = Math.floor(height / this.cellHeight);
		this.initGrid();
		this.setupCanvas();
		return { width: this.cols, height: this.rows };
	}
}

// Update NeovimClient class
class NeovimClient {
	constructor() {
		this.ws = null;
		this.connected = false;
		this.renderer = null;
	}

	initRenderer() {
		const canvas = document.getElementById("terminal");
		if (canvas) {
			this.renderer = new NeovimRenderer(canvas);
			console.log(
				"Renderer initialized with dimensions:",
				this.renderer.cols,
				"x",
				this.renderer.rows,
			);
		}
	}

	handleMessage(msg) {
		switch (msg.type) {
			case "ready":
				console.log("Ready to connect to Neovim");
				this.updateStatus("Ready to connect to Neovim");
				break;
			case "connected":
				this.connected = true;
				console.log("Connected to Neovim");
				this.updateStatus(
					"Connected to Neovim successfully! Initializing UI...",
				);
				this.initRenderer();
				// Request UI attachment
				this.attachUI();
				document.getElementById("terminal").focus();
				break;
			case "error":
				console.error("Error:", msg.data);
				this.updateStatus("Error: " + msg.data);
				break;
			case "redraw":
				if (this.renderer && Array.isArray(msg.data)) {
					console.log("Processing redraw event:", msg.data);
					// msg.data is the complete event: ["grid_line", [1,16,0,[...], false]]
					this.renderer.handleRedrawEvent(msg.data);
				} else {
					console.log("Redraw event but no renderer:", msg.data);
				}
				break;
			default:
				console.log("Unknown message type:", msg.type);
		}
	}

	attachUI() {
		if (this.connected && this.ws && this.renderer) {
			console.log(
				"Attaching UI with dimensions:",
				this.renderer.cols,
				"x",
				this.renderer.rows,
			);
			this.ws.send(
				JSON.stringify({
					type: "attach_ui",
					width: this.renderer.cols,
					height: this.renderer.rows,
				}),
			);
			this.updateStatus("UI attachment requested...");
		}
	}

	connect() {
		console.log("Attempting WebSocket connection...");
		this.ws = new WebSocket("ws://localhost:9998/ws");

		this.ws.onopen = () => {
			console.log("WebSocket connected");
			this.updateStatus("WebSocket connected");
			this.setupResizeHandler(); // Add this line
		};

		this.ws.onmessage = (event) => {
			console.log("Received message:", event.data);
			const msg = JSON.parse(event.data);
			this.handleMessage(msg);
		};

		this.ws.onclose = () => {
			console.log("WebSocket disconnected");
			this.connected = false;
			this.updateStatus("WebSocket disconnected");
		};

		this.ws.onerror = (error) => {
			console.error("WebSocket error:", error);
			this.updateStatus("WebSocket error");
		};
	}

	setupKeyboardHandlers() {
		document.addEventListener("DOMContentLoaded", () => {
			const terminal = document.getElementById("terminal");
			if (!terminal) {
				console.error("Terminal element not found");
				return;
			}

			terminal.addEventListener("keydown", (event) => {
				if (!this.connected) return;

				event.preventDefault();

				let key = "";

				if (event.key === "Enter") {
					key = "<CR>";
				} else if (event.key === "Escape") {
					key = "<Esc>";
				} else if (event.key === "Backspace") {
					key = "<BS>";
				} else if (event.key === "Tab") {
					key = "<Tab>";
				} else if (event.key === "ArrowUp") {
					key = "<Up>";
				} else if (event.key === "ArrowDown") {
					key = "<Down>";
				} else if (event.key === "ArrowLeft") {
					key = "<Left>";
				} else if (event.key === "ArrowRight") {
					key = "<Right>";
				} else if (event.ctrlKey && event.key.length === 1) {
					key = `<C-${event.key.toLowerCase()}>`;
				} else if (event.key.length === 1) {
					key = event.key;
				}

				if (key) {
					this.sendInput(key);
					console.log("Sent key:", key);
				}
			});

			terminal.focus();
		});
	}

	setupResizeHandler() {
		let resizeTimeout;

		window.addEventListener("resize", () => {
			if (!this.connected || !this.renderer) return;

			// Debounce resize events
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				const canvas = document.getElementById("terminal");
				if (!canvas) return;

				// Get container dimensions (you might want to adjust this)
				const containerWidth = window.innerWidth - 40; // Account for padding
				const containerHeight = window.innerHeight - 120; // Account for form and padding

				// Calculate new grid dimensions
				const newDimensions = this.renderer.resize(
					containerWidth,
					containerHeight,
				);

				console.log("Resizing to:", newDimensions);

				// Send resize message to server
				this.sendResize(newDimensions.width, newDimensions.height);
			}, 100);
		});
	}

	sendResize(width, height) {
		if (this.connected && this.ws) {
			console.log("Sending resize:", width, "x", height);
			this.ws.send(
				JSON.stringify({
					type: "resize",
					width: width,
					height: height,
				}),
			);
		}
	}

	connectToNeovim(address) {
		console.log("connectToNeovim called with address:", address);
		console.log("WebSocket state:", this.ws ? this.ws.readyState : "null");

		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			console.log("Sending connect message");
			this.ws.send(
				JSON.stringify({
					type: "connect",
					address: address,
				}),
			);
		} else {
			console.error("WebSocket not ready");
			this.updateStatus("WebSocket not connected");
		}
	}

	updateStatus(message) {
		console.log("Status update:", message);
		const statusDiv = document.getElementById("status");
		if (statusDiv) {
			statusDiv.textContent = message;
		}
	}

	sendInput(input) {
		if (this.connected && this.ws) {
			this.ws.send(
				JSON.stringify({
					type: "input",
					data: input,
				}),
			);
		}
	}

	sendCommand(command) {
		if (this.connected && this.ws) {
			this.ws.send(
				JSON.stringify({
					type: "command",
					data: command,
				}),
			);
		}
	}
}

// Initialize client
const client = new NeovimClient();

// Setup keyboard handlers immediately
client.setupKeyboardHandlers();

// Connect when page loads
window.addEventListener("load", () => {
	console.log("Page loaded, connecting...");
	client.connect();
});

// Make function globally accessible
window.connectToNeovim = function () {
	console.log("Connect button clicked");
	const addressInput = document.getElementById("nvim-address");
	if (!addressInput) {
		console.error("Address input not found");
		return;
	}

	const address = addressInput.value;
	console.log("Address value:", address);

	if (address.trim()) {
		client.connectToNeovim(address);
	} else {
		client.updateStatus("Please enter a valid address");
	}
};
