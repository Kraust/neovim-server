class NeovimRenderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.fontFamily = "monospace";
		this.fontSize = 14;
		this.cellWidth = 12;
		this.cellHeight = 20;
		this.rows = 24;
		this.cols = 80;
		this.grid = [];
		this.cursor = { row: 0, col: 0 };
		this.cursorMode = "normal";
		this.cursorVisible = true;
		this.renderPending = false;
		this.lastRenderTime = 0;
		this.targetFPS = 60;
		this.frameInterval = 1000 / this.targetFPS;
		this.colors = {
			fg: "#ffffff",
			bg: "#000000",
		};
		this.highlights = new Map();

		this.initGrid();
		this.setupCanvas();
		this.updateFont();
		this.startCursorBlink();
	}

	updateFont() {
		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

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

		// Add performance optimizations
		this.ctx.imageSmoothingEnabled = false; // Disable antialiasing for text
		this.ctx.textRenderingOptimization = "optimizeSpeed";

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

		// Use a more comprehensive check including Unicode East Asian Width property
		return (
			// CJK Unified Ideographs
			(code >= 0x4e00 && code <= 0x9fff) ||
			// CJK Extension A
			(code >= 0x3400 && code <= 0x4dbf) ||
			// CJK Extension B
			(code >= 0x20000 && code <= 0x2a6df) ||
			// Hangul Syllables
			(code >= 0xac00 && code <= 0xd7af) ||
			// Hiragana
			(code >= 0x3040 && code <= 0x309f) ||
			// Katakana
			(code >= 0x30a0 && code <= 0x30ff) ||
			// Emoji ranges (comprehensive)
			(code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
			(code >= 0x1f300 && code <= 0x1f5ff) || // Misc Symbols
			(code >= 0x1f680 && code <= 0x1f6ff) || // Transport
			(code >= 0x1f1e0 && code <= 0x1f1ff) || // Flags
			(code >= 0x2600 && code <= 0x26ff) || // Misc symbols
			(code >= 0x2700 && code <= 0x27bf) || // Dingbats
			(code >= 0x1f900 && code <= 0x1f9ff) || // Supplemental Symbols
			(code >= 0x1fa70 && code <= 0x1faff) || // Extended-A
			// Additional ranges for symbols that should be double-width
			(code >= 0x2e80 && code <= 0x2eff) || // CJK Radicals
			(code >= 0x2f00 && code <= 0x2fdf) || // Kangxi Radicals
			(code >= 0x3000 && code <= 0x303f) || // CJK Symbols
			(code >= 0xff00 && code <= 0xffef) || // Halfwidth/Fullwidth Forms
			// Nerd Fonts icon ranges
			(code >= 0x23fb && code <= 0x23fe) || // IEC Power Symbols
			code === 0x2665 || // Octicons (heart)
			code === 0x26a1 || // Octicons (lightning)
			code === 0x2b58 || // IEC Power Symbols
			(code >= 0xe000 && code <= 0xe00a) || // Pomicons
			(code >= 0xe0a0 && code <= 0xe0a2) || // Powerline
			code === 0xe0a3 || // Powerline Extra
			(code >= 0xe0b0 && code <= 0xe0b3) || // Powerline
			(code >= 0xe0b4 && code <= 0xe0c8) || // Powerline Extra
			code === 0xe0ca || // Powerline Extra
			(code >= 0xe0cc && code <= 0xe0d7) || // Powerline Extra
			(code >= 0xe200 && code <= 0xe2a9) || // Font Awesome Extension
			(code >= 0xe300 && code <= 0xe3e3) || // Weather Icons
			(code >= 0xe5fa && code <= 0xe6b7) || // Seti-UI + Custom
			(code >= 0xe700 && code <= 0xe8ef) || // Devicons
			(code >= 0xea60 && code <= 0xec1e) || // Codicons
			(code >= 0xed00 && code <= 0xefce) || // Font Awesome (relocated)
			(code >= 0xf000 && code <= 0xf2ff) || // Font Awesome (relocated)
			(code >= 0xf300 && code <= 0xf381) || // Font Logos
			(code >= 0xf400 && code <= 0xf533) || // Octicons (relocated)
			(code >= 0xf500 && code <= 0xfd46) || // Material Design (old range)
			(code >= 0xf0001 && code <= 0xf1af0) // Material Design (new range)
		);
	}

	drawCell(row, col, cell) {
		const x = col * this.cellWidth;
		const y = row * this.cellHeight;

		this.ctx.fillStyle = cell.bg;
		this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

		if (cell.isDoubleWidth && col + 1 < this.cols) {
			this.ctx.fillRect(x + this.cellWidth, y, this.cellWidth, this.cellHeight);
		}

		if (cell.char && cell.char !== " ") {
			this.ctx.fillStyle = cell.fg;

			if (cell.isDoubleWidth) {
				this.ctx.save();
				this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
				this.ctx.textAlign = "left";
				this.ctx.textBaseline = "top";
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

		const modeStyle =
			this.modeStyles && this.currentModeIndex !== undefined
				? this.modeStyles[this.currentModeIndex]
				: null;
		const cursorShape = modeStyle
			? modeStyle.cursorShape
			: this.getCursorShapeForMode(this.cursorMode);

		switch (cursorShape) {
			case "block":
				this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);
				const cell =
					this.grid[this.cursor.row] &&
					this.grid[this.cursor.row][this.cursor.col];
				if (cell && cell.char && cell.char !== " ") {
					this.ctx.fillStyle = cell.bg || this.colors.bg;
					this.ctx.fillText(cell.char, x, y + 2);
				}
				break;

			case "vertical":
				this.ctx.fillRect(x, y, 2, this.cellHeight);
				break;

			case "horizontal":
				const height = Math.max(2, Math.floor(this.cellHeight * 0.2));
				this.ctx.fillRect(
					x,
					y + this.cellHeight - height,
					this.cellWidth,
					height,
				);
				break;

			default:
				this.ctx.fillRect(x, y + this.cellHeight - 2, this.cellWidth, 2);
		}
	}

	getCursorShapeForMode(mode) {
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
				this.requestRedraw();
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
			this.currentModeIndex = modeIdx;
			this.startCursorBlink();
		}
	}

	handleModeInfoSet(eventData) {
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

			if (grid !== 1) continue;

			if (rows > 0) {
				for (let row = top; row < bot - rows; row++) {
					for (let col = left; col < right; col++) {
						if (row + rows < this.rows && col < this.cols) {
							this.grid[row][col] = this.grid[row + rows][col];
						}
					}
				}
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
				const absRows = Math.abs(rows);
				for (let row = bot - 1; row >= top + absRows; row--) {
					for (let col = left; col < right; col++) {
						if (row - absRows >= 0 && col < this.cols) {
							this.grid[row][col] = this.grid[row - absRows][col];
						}
					}
				}
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
	}

	handleWinViewport(eventData) {
		for (const viewportData of eventData) {
			if (!Array.isArray(viewportData) || viewportData.length < 6) continue;

			const [grid, win, topline, botline, curline, curcol] = viewportData;

			if (grid === 1) {
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

			if (!cell) {
				visualCol++;
				currentLogicalCol++;
				continue;
			}

			if (cell.isDoubleWidth) {
				visualCol += 2;
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
		this.clear();
	}

	handleGridClear() {
		this.initGrid();
		this.clear();
	}

	rgbToHex(rgb) {
		if (rgb === undefined || rgb === null) {
			return null;
		}
		if (rgb === -1) {
			return null;
		}

		const value = rgb < 0 ? 0xffffff + rgb + 1 : rgb;
		return "#" + value.toString(16).padStart(6, "0");
	}

	requestRedraw() {
		if (this.renderPending) return;

		const now = performance.now();
		const timeSinceLastRender = now - this.lastRenderTime;

		if (timeSinceLastRender >= this.frameInterval) {
			// Render immediately if enough time has passed
			this.renderPending = true;
			requestAnimationFrame(() => {
				this.redraw();
				this.lastRenderTime = performance.now();
				this.renderPending = false;
			});
		} else {
			// Schedule render for later
			this.renderPending = true;
			setTimeout(() => {
				requestAnimationFrame(() => {
					this.redraw();
					this.lastRenderTime = performance.now();
					this.renderPending = false;
				});
			}, this.frameInterval - timeSinceLastRender);
		}
	}

	redraw() {
		this.clear();
		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				const cell = this.grid[row][col];
				if (cell) {
					this.drawCell(row, col, cell);
					if (cell.isDoubleWidth) {
						col++;
					}
				}
			}
		}
		this.drawCursor();
	}

	resize(width, height) {
		this.canvas.style.width = width + "px";
		this.canvas.style.height = height + "px";
		this.canvas.width = width;
		this.canvas.height = height;

		this.cols = Math.floor(width / this.cellWidth);
		this.rows = Math.floor(height / this.cellHeight);

		this.initGrid();

		this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
		this.ctx.textBaseline = "top";

		this.redraw();
		return { width: this.cols, height: this.rows };
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = NeovimRenderer;
}
