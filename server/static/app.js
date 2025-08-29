class NeovimRenderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.fontFamily = "monospace";
		this.fontSize = 16;
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
		this.updateFont();
	}

	updateFont() {
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

		// Measure character dimensions
		const metrics = this.ctx.measureText("M");
		this.cellWidth = Math.ceil(metrics.width);
		this.cellHeight = Math.ceil(this.fontSize * 1.2); // Add line spacing

		// Recalculate grid dimensions based on current canvas size
		const currentWidth = this.canvas.offsetWidth;
		const currentHeight = this.canvas.offsetHeight;

		this.cols = Math.floor(currentWidth / this.cellWidth);
		this.rows = Math.floor(currentHeight / this.cellHeight);

		// Update canvas resolution to match display size
		this.canvas.width = currentWidth;
		this.canvas.height = currentHeight;

		// Reset font after canvas resize (canvas resize clears context)
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

		this.initGrid();
		this.redraw();
	}

	checkFontAvailable(fontName) {
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");

		ctx.font = "12px monospace";
		const baselineWidth = ctx.measureText("M").width;

		ctx.font = `12px ${fontName}, monospace`;
		const testWidth = ctx.measureText("M").width;

		return baselineWidth !== testWidth;
	}

	setFont(fontString) {
		const fontMatch =
			fontString.match(/^([^:]+)(?::h(\d+))?$/) ||
			fontString.match(/^([^\d]+)\s+(\d+)$/);

		if (fontMatch) {
			let fontFamily = fontMatch[1].trim();
			const newFontSize = parseInt(fontMatch[2]) || 16;

			// Only update if size actually changed
			if (newFontSize !== this.fontSize) {
				this.fontSize = newFontSize;
				console.log(`Font size changed to: ${this.fontSize}px`);
			}

			// Check if font is available, fallback to system alternatives
			if (this.checkFontAvailable(fontFamily)) {
				this.fontFamily = `${fontFamily}, monospace`;
			} else {
				console.warn(`Font ${fontFamily} not available, using fallback`);
				this.fontFamily = "Consolas, Courier New, monospace";
			}
		}

		this.updateFont();

		// Notify client to send resize to server
		if (window.client && window.client.connected) {
			window.client.sendResize(this.cols, this.rows);
		}
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
				this.handleOptionSet(eventData);
				break;
			case "grid_resize":
				console.log("Grid resize:", eventData);
				this.handleGridResize(eventData);
				break;
			case "grid_line":
				console.log("Grid line:", eventData);
				this.handleGridLine(eventData);
				// Remove redraw call from here
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
				this.redraw(); // Only redraw on flush
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

	handleOptionSet(eventData) {
		for (const optionData of eventData) {
			const [name, value] = optionData;
			console.log(`Option ${name} set to:`, value);

			switch (name) {
				case "guifont":
					if (value && typeof value === "string") {
						this.setFont(value);
					}
					break;
				case "linespace":
					if (typeof value === "number") {
						this.cellHeight = Math.ceil(this.fontSize * (1.2 + value / 10));
						this.setupCanvas();
					}
					break;
			}
		}
	}

	handleHlAttrDefine(eventData) {
		for (const hlData of eventData) {
			const [id, rgbAttrs, ctermAttrs, info] = hlData;

			// Ensure we have valid RGB attributes
			const attrs = rgbAttrs || {};

			this.highlights.set(id, {
				fg:
					attrs.foreground !== undefined
						? this.rgbToHex(attrs.foreground)
						: this.colors.fg,
				bg:
					attrs.background !== undefined
						? this.rgbToHex(attrs.background)
						: this.colors.bg,
				bold: attrs.bold || false,
				italic: attrs.italic || false,
				underline: attrs.underline || false,
				reverse: attrs.reverse || false,
			});

			console.log(`Highlight ${id} defined:`, this.highlights.get(id));
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

		for (const lineData of eventData) {
			if (!Array.isArray(lineData) || lineData.length < 4) continue;

			const [grid, row, colStart, cells, wrap] = lineData;

			if (grid !== 1) continue;
			if (row >= this.rows || row < 0) continue;

			let col = colStart;
			let currentHlId = 0; // Track current highlight ID

			if (cells && Array.isArray(cells)) {
				for (const cellData of cells) {
					if (col >= this.cols) break;

					let char, hlId, repeatCount;

					if (Array.isArray(cellData)) {
						char = cellData[0] || " ";
						// Update highlight ID if provided, otherwise keep current
						if (cellData.length > 1 && cellData[1] !== undefined) {
							currentHlId = cellData[1];
						}
						hlId = currentHlId;
						repeatCount = cellData.length > 2 ? cellData[2] : 1;
					} else {
						char = cellData || " ";
						hlId = currentHlId; // Use current highlight
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

		// Don't redraw immediately - wait for flush event
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
		if (rgb === undefined || rgb === null) {
			return null; // Let caller handle default
		}
		if (rgb === -1) {
			return null; // Use default color
		}

		// Handle negative values (Neovim sometimes sends these)
		const value = rgb < 0 ? 0xffffff + rgb + 1 : rgb;
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

			// Set initial canvas size to fill available space
			const connectionForm = document.getElementById("connection-form");
			const formHeight = connectionForm ? connectionForm.offsetHeight + 40 : 80;
			const containerWidth = window.innerWidth - 42;
			const containerHeight = window.innerHeight - formHeight - 40;

			canvas.style.width = containerWidth + "px";
			canvas.style.height = containerHeight + "px";

			const newDimensions = this.renderer.resize(
				containerWidth,
				containerHeight,
			);

			console.log(
				"Renderer initialized with dimensions:",
				newDimensions.width,
				"x",
				newDimensions.height,
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
				this.attachUI();

				// Enable mouse support in Neovim
				this.sendCommand("set mouse=a");

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
			this.setupResizeHandler();
			this.setupMouseHandlers();
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

	setupMouseHandlers() {
		const terminal = document.getElementById("terminal");
		if (!terminal) return;

		terminal.addEventListener("mousedown", (event) => {
			if (!this.connected || !this.renderer) return;

			const coords = this.getMouseCoords(event);
			this.sendMouseEvent("press", coords.row, coords.col, event.button);
			event.preventDefault();
		});

		terminal.addEventListener("mouseup", (event) => {
			if (!this.connected || !this.renderer) return;

			const coords = this.getMouseCoords(event);
			this.sendMouseEvent("release", coords.row, coords.col, event.button);
			event.preventDefault();
		});

		terminal.addEventListener("wheel", (event) => {
			if (!this.connected || !this.renderer) return;

			const coords = this.getMouseCoords(event);
			const direction = event.deltaY > 0 ? "down" : "up";
			this.sendScrollEvent(direction, coords.row, coords.col);
			event.preventDefault();
		});
	}

	getMouseCoords(event) {
		const rect = event.target.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const col = Math.floor(x / this.renderer.cellWidth);
		const row = Math.floor(y / this.renderer.cellHeight);

		return {
			row: Math.max(0, Math.min(row, this.renderer.rows - 1)),
			col: Math.max(0, Math.min(col, this.renderer.cols - 1)),
		};
	}

	sendMouseEvent(action, row, col, button) {
		if (!this.connected || !this.ws) return;

		this.ws.send(
			JSON.stringify({
				type: "mouse",
				action: action,
				button: button,
				row: row,
				col: col,
			}),
		);
	}

	sendScrollEvent(direction, row, col) {
		if (!this.connected || !this.ws) return;

		this.ws.send(
			JSON.stringify({
				type: "scroll",
				direction: direction,
				row: row,
				col: col,
			}),
		);
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

		const handleResize = () => {
			if (!this.connected || !this.renderer) return;

			const canvas = document.getElementById("terminal");
			if (!canvas) return;

			// Get the connection form height
			const connectionForm = document.getElementById("connection-form");
			const formHeight = connectionForm ? connectionForm.offsetHeight + 40 : 80; // Include margins

			// Calculate available space
			const containerWidth = window.innerWidth - 42; // Account for margins and border
			const containerHeight = window.innerHeight - formHeight - 40; // Account for form and margins

			// Update canvas size
			canvas.style.width = containerWidth + "px";
			canvas.style.height = containerHeight + "px";

			// Calculate new grid dimensions
			const newDimensions = this.renderer.resize(
				containerWidth,
				containerHeight,
			);

			console.log("Resizing to:", newDimensions);
			this.sendResize(newDimensions.width, newDimensions.height);
		};

		window.addEventListener("resize", () => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(handleResize, 100);
		});

		// Initial resize
		setTimeout(handleResize, 100);
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
window.client = client; // Make globally accessible

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
