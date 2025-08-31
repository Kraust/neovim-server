class NeovimClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.renderer = null;
        this.clipboardEnabled = navigator.clipboard &&
            globalThis.isSecureContext;
        this.lastClipboardContent = "";
        this.requestClipboardPermission();
    }

    initRenderer() {
        const canvas = document.getElementById("terminal");
        if (canvas) {
            this.renderer = new NeovimRenderer(canvas);
        }
    }

    showConnectionForm() {
        const connectionForm = document.getElementById("connection-form");
        const terminal = document.getElementById("terminal");

        if (connectionForm) {
            connectionForm.style.display = "block";
            connectionForm.style.opacity = "1";
        }

        if (terminal) {
            terminal.classList.remove("connected");
            terminal.style.display = "none";
        }

        if (this.renderer) {
            this.renderer = null;
        }

        const addressInput = document.getElementById("nvim-address");
        if (addressInput) {
            addressInput.focus();
        }
    }

    updateTitle(serverAddress = null, status = null) {
        let title = "Neovim Server";

        if (serverAddress) {
            title += ` - ${serverAddress}`;
        }

        if (status) {
            title += ` (${status})`;
        }

        document.title = title;
    }

    updateFavicon(status = "default") {
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement("link");
            link.type = "image/x-icon";
            link.rel = "shortcut icon";
            document.head.appendChild(link);
        }

        let svgContent;
        switch (status) {
            case "connected":
                svgContent =
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">✅</text></svg>';
                break;
            case "connecting":
                svgContent =
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🔄</text></svg>';
                break;
            case "error":
                svgContent =
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">❌</text></svg>';
                break;
            default:
                svgContent =
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📝</text></svg>';
        }

        link.href = "data:image/svg+xml," + encodeURIComponent(svgContent);
    }

    handleMessage(msg) {
        switch (msg.type) {
            case "ready": {
                this.updateStatus("Ready to connect to Neovim");
                this.updateTitle();
                this.updateFavicon("default");
                break;
            }
            case "connected": {
                this.connected = true;
                this.updateStatus(
                    "Connected to Neovim successfully! Initializing UI...",
                );

                const addressInput = document.getElementById("nvim-address");
                if (addressInput && addressInput.value) {
                    this.updateTitle(addressInput.value);
                    this.updateFavicon("connected");
                }

                this.hideConnectionForm();
                this.initRenderer();

                setTimeout(() => {
                    this.resizeTerminalToFullViewport();
                    this.attachUI();
                }, 100);

                this.sendCommand("set mouse=a");

                document.getElementById("terminal").focus();
                break;
            }
            case "session_closed": {
                this.connected = false;
                this.updateStatus("Neovim session closed - " + msg.data);
                this.updateTitle();
                this.updateFavicon("error");
                this.showConnectionForm();
                break;
            }
            case "error": {
                console.error("Error:", msg.data);
                this.updateStatus("Error: " + msg.data);
                this.updateTitle();
                this.updateFavicon("error");
                break;
            }
            case "redraw": {
                if (this.renderer && Array.isArray(msg.data)) {
                    this.renderer.handleRedrawEvent(msg.data);
                }
                break;
            }
            case "clipboard_set": {
                if (this.clipboardEnabled && msg.data) {
                    this.syncToSystemClipboard(msg.data);
                }
                break;
            }
            case "clipboard_get": {
                this.sendClipboardToNeovim();
                break;
            }
            default: {
                console.log("Unknown message type:", msg.type);
            }
        }
    }

    autoConnect(address) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.connectToNeovim(address);
        } else {
            const checkConnection = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    clearInterval(checkConnection);
                    this.connectToNeovim(address);
                }
            }, 100);

            setTimeout(() => {
                clearInterval(checkConnection);
                this.updateStatus(
                    "Failed to establish WebSocket connection for auto-connect",
                );
            }, 5000);
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

        this.resizeTerminalToFullViewport();
    }

    resizeTerminalToFullViewport() {
        const canvas = document.getElementById("terminal");
        if (!canvas || !this.renderer) return;

        const containerWidth = globalThis.innerWidth;
        const containerHeight = globalThis.innerHeight;

        const newDimensions = this.renderer.resize(
            containerWidth,
            containerHeight,
        );
        this.sendResize(newDimensions.width, newDimensions.height);
    }

    connect() {
        const protocol = globalThis.location.protocol === "https:"
            ? "wss:"
            : "ws:";
        const wsUrl = `${protocol}//${globalThis.location.host}/ws`;
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
            this.updateStatus("WebSocket disconnected - Connection lost");
            this.updateTitle();
            this.updateFavicon("error");
            this.showConnectionForm();
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket error:", error);
            this.updateStatus("WebSocket error");
            this.updateFavicon("error");
            this.showConnectionForm();
        };
    }

    setupMouseHandlers() {
        const terminal = document.getElementById("terminal");
        if (!terminal) return;

        let dragThrottle = null;

        terminal.addEventListener("click", () => {
            terminal.focus();
        });

        // Enhance the focus handler to always sync clipboard
        terminal.addEventListener("focus", () => {
            if (this.connected && this.clipboardEnabled) {
                this.sendClipboardToNeovim();
            }
        });

        // Also sync on window focus
        globalThis.addEventListener("focus", () => {
            if (this.connected && this.clipboardEnabled) {
                this.sendClipboardToNeovim();
            }
        });

        terminal.addEventListener("mousedown", (event) => {
            if (!this.connected || !this.renderer) return;
            terminal.focus();

            const coords = this.getMouseCoords(event);
            this.sendMouseEvent("press", coords.row, coords.col, event.button);
            event.preventDefault();
        });

        terminal.addEventListener("mouseup", (event) => {
            if (!this.connected || !this.renderer) return;

            const coords = this.getMouseCoords(event);
            this.sendMouseEvent(
                "release",
                coords.row,
                coords.col,
                event.button,
            );
            event.preventDefault();
        });

        terminal.addEventListener("wheel", (event) => {
            if (!this.connected || !this.renderer) return;

            const coords = this.getMouseCoords(event);
            const direction = event.deltaY > 0 ? "down" : "up";
            this.sendScrollEvent(direction, coords.row, coords.col);
            event.preventDefault();
        });

        terminal.addEventListener("mousemove", (event) => {
            if (!this.connected || !this.renderer) return;

            if (event.buttons > 0) {
                if (!dragThrottle) {
                    dragThrottle = setTimeout(() => {
                        const coords = this.getMouseCoords(event);
                        this.sendMouseEvent(
                            "drag",
                            coords.row,
                            coords.col,
                            event.button,
                        );
                        dragThrottle = null;
                    }, 16);
                }
                event.preventDefault();
            }
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
                immediate: true,
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
                immediate: true,
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
                const key = this.translateKey(event);
                if (key) {
                    this.sendInput(key);
                }
            });

            terminal.focus();
        });
    }

    translateKey(event) {
        const { key, code, ctrlKey, altKey, shiftKey, metaKey } = event;

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

        for (let i = 1; i <= 12; i++) {
            specialKeys[`F${i}`] = `<F${i}>`;
        }

        let modifiers = "";
        if (ctrlKey) modifiers += "C-";
        if (altKey) modifiers += "A-";
        if (metaKey) modifiers += "D-";
        if (shiftKey && !this.isShiftableKey(key)) modifiers += "S-";

        if (specialKeys[key]) {
            if (modifiers) {
                return `<${modifiers}${specialKeys[key].slice(1, -1)}>`;
            }
            return specialKeys[key];
        }

        if (key.length === 1) {
            if (modifiers) {
                if (ctrlKey && !altKey && !metaKey) {
                    return `<C-${key.toLowerCase()}>`;
                }
                return `<${modifiers}${key}>`;
            }
            return key;
        }

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

            const connectionForm = document.getElementById("connection-form");
            const isFormVisible = connectionForm &&
                connectionForm.style.display !== "none";

            let containerWidth, containerHeight;

            if (isFormVisible) {
                const formHeight = connectionForm.offsetHeight + 40;
                containerWidth = globalThis.innerWidth;
                containerHeight = globalThis.innerHeight - formHeight - 40;
            } else {
                containerWidth = globalThis.innerWidth;
                containerHeight = globalThis.innerHeight - 40;
            }

            canvas.style.width = containerWidth + "px";
            canvas.style.height = containerHeight + "px";

            const newDimensions = this.renderer.resize(
                containerWidth,
                containerHeight,
            );
            this.sendResize(newDimensions.width, newDimensions.height);
        };

        globalThis.addEventListener("resize", () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 100);
        });

        setTimeout(handleResize, 100);
    }

    sendResize(width, height) {
        if (
            this.connected && this.ws && this.ws.readyState === WebSocket.OPEN
        ) {
            this.ws.send(
                JSON.stringify({
                    type: "resize",
                    width: width,
                    height: height,
                    immediate: true,
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
        if (
            this.connected && this.ws && this.ws.readyState === WebSocket.OPEN
        ) {
            this.ws.send(
                JSON.stringify({
                    type: "input",
                    data: input,
                    immediate: true,
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
                    immediate: true,
                }),
            );
        }
    }

    async syncToSystemClipboard(text) {
        if (!this.clipboardEnabled || text === this.lastClipboardContent) {
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            this.lastClipboardContent = text;
        } catch (err) {
            console.error("Failed to sync clipboard:", err);
        }
    }

    async sendClipboardToNeovim() {
        if (!this.clipboardEnabled) {
            return;
        }
        try {
            const text = await navigator.clipboard.readText();
            if (this.connected && this.ws) {
                this.ws.send(
                    JSON.stringify({
                        type: "clipboard_content",
                        data: text,
                    }),
                );
            }
        } catch (err) {
            console.error("Failed to read clipboard:", err);
            // Send empty content on error
            if (this.connected && this.ws) {
                this.ws.send(
                    JSON.stringify({
                        type: "clipboard_content",
                        data: "",
                    }),
                );
            }
        }
    }

    async requestClipboardPermission() {
        if (!navigator.clipboard || !globalThis.isSecureContext) {
            console.warn("Clipboard API not available (requires HTTPS)");
            return false;
        }
        try {
            const permission = await navigator.permissions.query({
                name: "clipboard-read",
            });
            if (permission.state === "granted") {
                this.clipboardEnabled = true;
                return true;
            } else if (permission.state === "prompt") {
                await navigator.clipboard.readText();
                this.clipboardEnabled = true;
                return true;
            }
        } catch (_err) {
            this.clipboardEnabled = false;
        }
        return false;
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = NeovimClient;
}
