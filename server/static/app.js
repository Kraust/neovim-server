class NeovimRenderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.fontFamily = "monospace";
		this.fontSize = 14; // Reduce from 16 to 14 for better fit
		this.cellWidth = 12;
		this.cellHeight = 20;
		this.rows = 24;
		this.cols = 80;
		this.grid = [];
		this.cursor = { row: 0, col: 0 };
		this.cursorMode = "normal"; // Add cursor mode tracking
		this.cursorVisible = true;
		this.colors = {
			fg: "#ffffff",
			bg: "#000000",
		};
		this.highlights = new Map(); // Store highlight definitions

		this.initGrid();
		this.setupCanvas();
		this.updateFont();
		this.startCursorBlink();
	}

	updateFont() {
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

		// Force cell width to be exactly fontSize * 0.6 for most monospace fonts
		// Adjust this multiplier based on your Iosevka variant
		this.cellWidth = Math.round(this.fontSize * 0.6);
		this.cellHeight = Math.ceil(this.fontSize * 1.2);

		const currentWidth = this.canvas.width || this.canvas.offsetWidth;
		const currentHeight = this.canvas.height || this.canvas.offsetHeight;

		this.cols = Math.floor(currentWidth / this.cellWidth);
		this.rows = Math.floor(currentHeight / this.cellHeight);

		this.initGrid();
		this.redraw();

		if (window.client && window.client.connected) {
			window.client.sendResize(this.cols, this.rows);
		}
	}

	setFont(fontString) {
		const fontMatch =
			fontString.match(/^([^:]+)(?::h(\d+))?$/) ||
			fontString.match(/^([^\d]+)\s+(\d+)$/);

		if (fontMatch) {
			let fontFamily = fontMatch[1].trim();
			const newFontSize = parseInt(fontMatch[2]) || 12;

			if (newFontSize !== this.fontSize) {
				this.fontSize = newFontSize;
			}

			this.fontFamily = `${fontFamily},monospace`;
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
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";
		this.clear();
	}

	clear() {
		this.ctx.fillStyle = this.colors.bg;
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
	}

	isDoubleWidth(char) {
		if (!char || char.length === 0) return false;

		const code = char.codePointAt(0);
		if (!code) return false;

		// Common double-width ranges
		return (
			// CJK Unified Ideographs
			(code >= 0x4e00 && code <= 0x9fff) ||
			// CJK Extension A
			(code >= 0x3400 && code <= 0x4dbf) ||
			// Hangul Syllables
			(code >= 0xac00 && code <= 0xd7af) ||
			// Hiragana
			(code >= 0x3040 && code <= 0x309f) ||
			// Katakana
			(code >= 0x30a0 && code <= 0x30ff) ||
			// Emoji ranges
			(code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
			(code >= 0x1f300 && code <= 0x1f5ff) || // Misc Symbols
			(code >= 0x1f680 && code <= 0x1f6ff) || // Transport
			(code >= 0x1f1e0 && code <= 0x1f1ff) || // Flags
			(code >= 0x2600 && code <= 0x26ff) || // Misc symbols
			(code >= 0x2700 && code <= 0x27bf) || // Dingbats
			// Additional emoji ranges
			(code >= 0x1f900 && code <= 0x1f9ff) ||
			(code >= 0x1fa70 && code <= 0x1faff)
		);
	}

	drawCell(row, col, cell) {
		const x = col * this.cellWidth;
		const y = row * this.cellHeight;

		// Draw background - always draw single cell width
		this.ctx.fillStyle = cell.bg;
		this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

		// For double-width characters, also draw the next cell's background
		if (cell.isDoubleWidth && col + 1 < this.cols) {
			this.ctx.fillRect(x + this.cellWidth, y, this.cellWidth, this.cellHeight);
		}

		// Draw character
		if (cell.char && cell.char !== " ") {
			this.ctx.fillStyle = cell.fg;

			if (cell.isDoubleWidth) {
				this.ctx.save();
				this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
				this.ctx.textAlign = "left"; // Changed from "center"
				this.ctx.textBaseline = "top";
				// Render at the start of the first cell, let the character naturally span
				this.ctx.fillText(cell.char, x, y + 2);
				this.ctx.restore();
				this.ctx.textAlign = "start";
				this.ctx.textBaseline = "top";
			} else {
				this.ctx.fillText(cell.char, x, y + 2);
			}
		}
	}

	drawCursor() {
		if (!this.cursorVisible) return;

		const x = this.cursor.col * this.cellWidth;
		const y = this.cursor.row * this.cellHeight;

		this.ctx.fillStyle = "#ffffff";

		// Get cursor style based on current mode - FIX: use current mode index
		const modeStyle =
			this.modeStyles && this.currentModeIndex !== undefined
				? this.modeStyles[this.currentModeIndex]
				: null;
		const cursorShape = modeStyle
			? modeStyle.cursorShape
			: this.getCursorShapeForMode(this.cursorMode);

		switch (cursorShape) {
			case "block":
				// Block cursor (normal mode)
				this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);
				// Draw character in reverse
				const cell =
					this.grid[this.cursor.row] &&
					this.grid[this.cursor.row][this.cursor.col];
				if (cell && cell.char && cell.char !== " ") {
					this.ctx.fillStyle = cell.bg || this.colors.bg;
					this.ctx.fillText(cell.char, x, y + 2);
				}
				break;

			case "vertical":
				// Vertical bar cursor (insert mode)
				this.ctx.fillRect(x, y, 2, this.cellHeight);
				break;

			case "horizontal":
				// Horizontal cursor (replace mode)
				const height = Math.max(2, Math.floor(this.cellHeight * 0.2));
				this.ctx.fillRect(
					x,
					y + this.cellHeight - height,
					this.cellWidth,
					height,
				);
				break;

			default:
				// Default to underline
				this.ctx.fillRect(x, y + this.cellHeight - 2, this.cellWidth, 2);
		}
	}

	getCursorShapeForMode(mode) {
		// Fallback cursor shapes based on mode name
		switch (mode) {
			case "normal":
			case "visual":
			case "select":
				return "block";
			case "insert":
				return "vertical";
			case "replace":
				return "horizontal";
			case "cmdline":
			case "cmdline_normal":
				return "horizontal";
			default:
				return "block";
		}
	}

	startCursorBlink() {
		if (this.cursorBlinkTimer) {
			clearInterval(this.cursorBlinkTimer);
		}

		const modeStyle =
			this.modeStyles && this.currentModeIndex !== undefined
				? this.modeStyles[this.currentModeIndex]
				: null;

		if (modeStyle && (modeStyle.blinkon > 0 || modeStyle.blinkoff > 0)) {
			this.cursorBlinkTimer = setInterval(() => {
				this.cursorVisible = !this.cursorVisible;
				this.redraw();
			}, modeStyle.blinkon || 500);
		} else {
			this.cursorVisible = true;
		}
	}

	handleRedrawEvent(event) {
		if (!Array.isArray(event) || event.length === 0) {
			console.log("Invalid event format:", event);
			return;
		}

		const eventType = event[0];
		const eventData = event.slice(1);

		switch (eventType) {
			case "mode_change":
				this.handleModeChange(eventData);
				break;
			case "mode_info_set":
				this.handleModeInfoSet(eventData);
				break;
			case "option_set":
				this.handleOptionSet(eventData);
				break;
			case "grid_resize":
				this.handleGridResize(eventData);
				break;
			case "grid_line":
				this.handleGridLine(eventData);
				break;
			case "grid_cursor_goto":
				this.handleCursorGoto(eventData);
				break;
			case "grid_clear":
				this.handleGridClear();
				break;
			case "default_colors_set":
				this.handleDefaultColors(eventData);
				break;
			case "flush":
				this.redraw();
				break;
			case "hl_attr_define":
				this.handleHlAttrDefine(eventData);
				break;
			case "win_viewport":
				this.handleWinViewport(eventData);
				break;
			case "grid_scroll":
				this.handleGridScroll(eventData);
				break;
			case "hl_group_set":
				break;
			case "chdir":
				break;
			default:
				console.log("Unhandled event type:", eventType, eventData);
		}
	}

	handleModeChange(eventData) {
		for (const modeData of eventData) {
			const [mode, modeIdx] = modeData;
			this.cursorMode = mode;
			this.currentModeIndex = modeIdx; // Add this line
			this.startCursorBlink();
		}
	}

	handleModeInfoSet(eventData) {
		// Store cursor style information for different modes
		for (const modeInfo of eventData) {
			const [cursorStyleEnabled, modeInfoList] = modeInfo;
			if (cursorStyleEnabled && Array.isArray(modeInfoList)) {
				this.modeStyles = {};
				modeInfoList.forEach((info, idx) => {
					if (info && typeof info === "object") {
						this.modeStyles[idx] = {
							cursorShape: info.cursor_shape || "block",
							cellPercentage: info.cell_percentage || 100,
							blinkwait: info.blinkwait || 0,
							blinkon: info.blinkon || 0,
							blinkoff: info.blinkoff || 0,
						};
					}
				});
				this.startCursorBlink();
			}
		}
	}

	handleGridScroll(eventData) {
		for (const scrollData of eventData) {
			if (!Array.isArray(scrollData) || scrollData.length < 7) continue;

			const [grid, top, bot, left, right, rows, cols] = scrollData;

			if (grid !== 1) continue; // Only handle main grid

			// Scroll the specified region
			if (rows > 0) {
				// Scroll down - move content up
				for (let row = top; row < bot - rows; row++) {
					for (let col = left; col < right; col++) {
						if (row + rows < this.rows && col < this.cols) {
							this.grid[row][col] = this.grid[row + rows][col];
						}
					}
				}
				// Clear the bottom rows
				for (let row = bot - rows; row < bot; row++) {
					for (let col = left; col < right; col++) {
						if (row < this.rows && col < this.cols) {
							this.grid[row][col] = {
								char: " ",
								fg: this.colors.fg,
								bg: this.colors.bg,
							};
						}
					}
				}
			} else if (rows < 0) {
				// Scroll up - move content down
				const absRows = Math.abs(rows);
				for (let row = bot - 1; row >= top + absRows; row--) {
					for (let col = left; col < right; col++) {
						if (row - absRows >= 0 && col < this.cols) {
							this.grid[row][col] = this.grid[row - absRows][col];
						}
					}
				}
				// Clear the top rows
				for (let row = top; row < top + absRows; row++) {
					for (let col = left; col < right; col++) {
						if (row < this.rows && col < this.cols) {
							this.grid[row][col] = {
								char: " ",
								fg: this.colors.fg,
								bg: this.colors.bg,
							};
						}
					}
				}
			}
		}
		// Don't redraw immediately - wait for flush event
	}

	handleWinViewport(eventData) {
		for (const viewportData of eventData) {
			if (!Array.isArray(viewportData) || viewportData.length < 6) continue;

			const [grid, win, topline, botline, curline, curcol] = viewportData;

			// Store viewport info if needed for scrolling/rendering optimizations
			if (grid === 1) {
				// Main grid viewport update
				console.log(
					`Viewport: lines ${topline}-${botline}, cursor at ${curline},${curcol}`,
				);
			}
		}
	}

	handleOptionSet(eventData) {
		for (const optionData of eventData) {
			const [name, value] = optionData;
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
				default:
					console.log(`Unhandled Option ${name} set to:`, value);
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
		}
	}

	handleGridResize(args) {
		if (!args || args.length === 0) return;
		const [grid, width, height] = args[0] || args;
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
			let currentHlId = 0;

			if (cells && Array.isArray(cells)) {
				for (const cellData of cells) {
					if (col >= this.cols) break;

					let char, hlId, repeatCount;

					if (Array.isArray(cellData)) {
						char = cellData[0] || " ";
						if (cellData.length > 1 && cellData[1] !== undefined) {
							currentHlId = cellData[1];
						}
						hlId = currentHlId;
						repeatCount = cellData.length > 2 ? cellData[2] : 1;
					} else {
						char = cellData || " ";
						hlId = currentHlId;
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
							isDoubleWidth: this.isDoubleWidth(char),
						};

						// Always advance by 1 - Neovim already handles double-width spacing
						col++;
					}
				}
			}
		}
	}

	handleCursorGoto(args) {
		if (!args || args.length === 0) return;
		const [grid, row, col] = args[0] || args;
		if (grid === 1) {
			// Convert logical cursor position to visual position
			const visualCol = this.logicalToVisualCol(row, col);
			this.cursor = { row, col: visualCol };
			this.redraw();
		}
	}

	logicalToVisualCol(row, logicalCol) {
		if (row >= this.rows || row < 0) return logicalCol;

		let visualCol = 0;
		let currentLogicalCol = 0;

		while (currentLogicalCol < logicalCol && visualCol < this.cols) {
			const cell = this.grid[row] && this.grid[row][visualCol];

			// If no cell data, assume single-width
			if (!cell) {
				visualCol++;
				currentLogicalCol++;
				continue;
			}

			// Check if this is a double-width character
			if (cell.isDoubleWidth) {
				visualCol += 2; // Skip both visual columns
			} else {
				visualCol++;
			}

			currentLogicalCol++;
		}

		return Math.min(visualCol, this.cols - 1);
	}

	handleDefaultColors(args) {
		if (!args || args.length === 0) return;
		const [fg, bg] = args[0] || args;
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
				const cell = this.grid[row][col];
				if (cell) {
					this.drawCell(row, col, cell);
					// Skip next column if this is a double-width character
					if (cell.isDoubleWidth) {
						col++; // Skip the next column
					}
				}
			}
		}
		this.drawCursor();
	}

	resize(width, height) {
		// Set canvas dimensions to match container
		this.canvas.style.width = width + "px";
		this.canvas.style.height = height + "px";
		this.canvas.width = width;
		this.canvas.height = height;

		// Calculate grid based on cell dimensions
		this.cols = Math.floor(width / this.cellWidth);
		this.rows = Math.floor(height / this.cellHeight);

		this.initGrid();

		// Restore font settings after canvas resize
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

		this.redraw();
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
			// Don't set initial size - let resizeTerminalToFullViewport handle it
		}
	}

	handleMessage(msg) {
		switch (msg.type) {
			case "ready":
				this.updateStatus("Ready to connect to Neovim");
				break;
			case "connected":
				this.connected = true;
				this.updateStatus(
					"Connected to Neovim successfully! Initializing UI...",
				);

				// Hide connection form and expand terminal
				this.hideConnectionForm();
				this.initRenderer();

				// Ensure terminal is properly sized to full viewport
				setTimeout(() => {
					this.resizeTerminalToFullViewport();
					this.attachUI();
				}, 100);

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
					this.renderer.handleRedrawEvent(msg.data);
				} else {
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
			this.renderer.startCursorBlink();
			this.updateStatus("UI attachment requested...");
		}
	}

	hideConnectionForm() {
		const connectionForm = document.getElementById("connection-form");
		const terminal = document.getElementById("terminal");

		if (connectionForm) {
			connectionForm.style.display = "none";
		}

		if (terminal) {
			terminal.classList.add("connected");
			terminal.style.display = "block";
		}

		// Trigger resize to expand terminal to full viewport
		this.resizeTerminalToFullViewport();
	}

	resizeTerminalToFullViewport() {
		const canvas = document.getElementById("terminal");
		if (!canvas || !this.renderer) return;

		// Use exact viewport dimensions
		const containerWidth = window.innerWidth;
		const containerHeight = window.innerHeight;

		const newDimensions = this.renderer.resize(containerWidth, containerHeight);
		this.sendResize(newDimensions.width, newDimensions.height);
	}

	connect() {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws`;
		this.ws = new WebSocket(wsUrl);

		this.ws.onopen = () => {
			this.updateStatus("WebSocket connected");
			this.setupResizeHandler();
			this.setupMouseHandlers();
		};

		this.ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			this.handleMessage(msg);
		};

		this.ws.onclose = () => {
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

		// Add focus on click
		terminal.addEventListener("click", () => {
			terminal.focus();
		});

		terminal.addEventListener("mousedown", (event) => {
			if (!this.connected || !this.renderer) return;
			terminal.focus(); // Ensure focus on mouse interaction

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

				// Don't prevent default for certain browser shortcuts
				if (
					event.ctrlKey &&
					["r", "f", "t", "w", "n"].includes(event.key.toLowerCase())
				) {
					return; // Allow browser shortcuts
				}

				event.preventDefault();

				let key = this.translateKey(event);

				if (key) {
					this.sendInput(key);
				}
			});

			terminal.focus();
		});
	}

	translateKey(event) {
		const { key, code, ctrlKey, altKey, shiftKey, metaKey } = event;

		// Handle special keys first
		const specialKeys = {
			Enter: "<CR>",
			Escape: "<Esc>",
			Backspace: "<BS>",
			Tab: "<Tab>",
			Delete: "<Del>",
			Insert: "<Insert>",
			Home: "<Home>",
			End: "<End>",
			PageUp: "<PageUp>",
			PageDown: "<PageDown>",
			ArrowUp: "<Up>",
			ArrowDown: "<Down>",
			ArrowLeft: "<Left>",
			ArrowRight: "<Right>",
			" ": "<Space>",
		};

		// Function keys
		for (let i = 1; i <= 12; i++) {
			specialKeys[`F${i}`] = `<F${i}>`;
		}

		// Handle modifier combinations
		let modifiers = "";
		if (ctrlKey) modifiers += "C-";
		if (altKey) modifiers += "A-";
		if (metaKey) modifiers += "D-"; // Command key on Mac
		if (shiftKey && !this.isShiftableKey(key)) modifiers += "S-";

		// Handle special keys with modifiers
		if (specialKeys[key]) {
			if (modifiers) {
				return `<${modifiers}${specialKeys[key].slice(1, -1)}>`;
			}
			return specialKeys[key];
		}

		// Handle regular characters
		if (key.length === 1) {
			if (modifiers) {
				// For Ctrl combinations, use lowercase
				if (ctrlKey && !altKey && !metaKey) {
					return `<C-${key.toLowerCase()}>`;
				}
				// For other modifier combinations
				return `<${modifiers}${key}>`;
			}
			return key;
		}

		// Handle numeric keypad
		if (code.startsWith("Numpad")) {
			const numpadKeys = {
				Numpad0: "0",
				Numpad1: "1",
				Numpad2: "2",
				Numpad3: "3",
				Numpad4: "4",
				Numpad5: "5",
				Numpad6: "6",
				Numpad7: "7",
				Numpad8: "8",
				Numpad9: "9",
				NumpadDecimal: ".",
				NumpadAdd: "+",
				NumpadSubtract: "-",
				NumpadMultiply: "*",
				NumpadDivide: "/",
				NumpadEnter: "<CR>",
			};

			if (numpadKeys[code]) {
				if (modifiers) {
					return `<${modifiers}${numpadKeys[code]}>`;
				}
				return numpadKeys[code];
			}
		}

		// Fallback for unhandled keys
		console.log("Unhandled key:", {
			key,
			code,
			ctrlKey,
			altKey,
			shiftKey,
			metaKey,
		});
		return null;
	}

	isShiftableKey(key) {
		const shiftableKeys = [
			"!",
			"@",
			"#",
			"$",
			"%",
			"^",
			"&",
			"*",
			"(",
			")",
			"_",
			"+",
			"{",
			"}",
			"|",
			":",
			'"',
			"<",
			">",
			"?",
			"~",
			"A",
			"B",
			"C",
			"D",
			"E",
			"F",
			"G",
			"H",
			"I",
			"J",
			"K",
			"L",
			"M",
			"N",
			"O",
			"P",
			"Q",
			"R",
			"S",
			"T",
			"U",
			"V",
			"W",
			"X",
			"Y",
			"Z",
		];
		return shiftableKeys.includes(key) || key.length === 1;
	}

	setupResizeHandler() {
		let resizeTimeout;

		const handleResize = () => {
			if (!this.connected || !this.renderer) return;

			const canvas = document.getElementById("terminal");
			if (!canvas) return;

			// Check if connection form is visible
			const connectionForm = document.getElementById("connection-form");
			const isFormVisible =
				connectionForm && connectionForm.style.display !== "none";

			let containerWidth, containerHeight;

			if (isFormVisible) {
				// Form is visible - account for its height
				const formHeight = connectionForm.offsetHeight + 40;
				containerWidth = window.innerWidth;
				containerHeight = window.innerHeight - formHeight - 40;
			} else {
				// Form is hidden - use full viewport
				containerWidth = window.innerWidth;
				containerHeight = window.innerHeight - 40;
			}

			canvas.style.width = containerWidth + "px";
			canvas.style.height = containerHeight + "px";

			const newDimensions = this.renderer.resize(
				containerWidth,
				containerHeight,
			);
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
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
	client.connect();
});

terminal.addEventListener("keyup", (event) => {
	if (!this.connected) return;
});

terminal.addEventListener("paste", (event) => {
	if (!this.connected) return;

	event.preventDefault();
	const text = event.clipboardData.getData("text");

	// Send pasted text character by character or as a block
	this.sendInput(text);
});

// Make function globally accessible
window.connectToNeovim = function () {
	const addressInput = document.getElementById("nvim-address");
	if (!addressInput) {
		console.error("Address input not found");
		return;
	}

	const address = addressInput.value;

	if (address.trim()) {
		client.connectToNeovim(address);
	} else {
		client.updateStatus("Please enter a valid address");
	}
};
