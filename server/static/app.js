class NeovimClient {
    constructor() {
        this.ws = null;
        this.connected = false;
    }

    connect() {
        console.log('Attempting WebSocket connection...');
        this.ws = new WebSocket('ws://localhost:9998/ws');
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.updateStatus('WebSocket connected');
        };

        this.ws.onmessage = (event) => {
            console.log('Received message:', event.data);
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this.updateStatus('WebSocket disconnected');
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.updateStatus('WebSocket error');
        };
    }

    setupKeyboardHandlers() {
        document.addEventListener('DOMContentLoaded', () => {
            const terminal = document.getElementById('terminal');
            if (!terminal) {
                console.error('Terminal element not found');
                return;
            }
            
            terminal.addEventListener('keydown', (event) => {
                if (!this.connected) return;
                
                event.preventDefault();
                
                let key = '';
                
                if (event.key === 'Enter') {
                    key = '<CR>';
                } else if (event.key === 'Escape') {
                    key = '<Esc>';
                } else if (event.key === 'Backspace') {
                    key = '<BS>';
                } else if (event.key === 'Tab') {
                    key = '<Tab>';
                } else if (event.key === 'ArrowUp') {
                    key = '<Up>';
                } else if (event.key === 'ArrowDown') {
                    key = '<Down>';
                } else if (event.key === 'ArrowLeft') {
                    key = '<Left>';
                } else if (event.key === 'ArrowRight') {
                    key = '<Right>';
                } else if (event.ctrlKey && event.key.length === 1) {
                    key = `<C-${event.key.toLowerCase()}>`;
                } else if (event.key.length === 1) {
                    key = event.key;
                }
                
                if (key) {
                    this.sendInput(key);
                    console.log('Sent key:', key);
                }
            });
            
            terminal.focus();
        });
    }

    connectToNeovim(address) {
        console.log('connectToNeovim called with address:', address);
        console.log('WebSocket state:', this.ws ? this.ws.readyState : 'null');
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('Sending connect message');
            this.ws.send(JSON.stringify({
                type: 'connect',
                address: address
            }));
        } else {
            console.error('WebSocket not ready');
            this.updateStatus('WebSocket not connected');
        }
    }

    handleMessage(msg) {
        console.log('Handling message:', msg);
        switch(msg.type) {
            case 'ready':
                console.log('Ready to connect to Neovim');
                this.updateStatus('Ready to connect to Neovim');
                break;
            case 'connected':
                this.connected = true;
                console.log('Connected to Neovim');
                this.updateStatus('Connected to Neovim successfully! Start typing in the terminal.');
                document.getElementById('terminal').focus();
                break;
            case 'error':
                console.error('Error:', msg.data);
                this.updateStatus('Error: ' + msg.data);
                break;
            case 'redraw':
                console.log('Redraw event:', msg.data);
                break;
            default:
                console.log('Unknown message type:', msg.type);
        }
    }

    updateStatus(message) {
        console.log('Status update:', message);
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = message;
        }
    }

    sendInput(input) {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'input',
                data: input
            }));
        }
    }

    sendCommand(command) {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify({
                type: 'command',
                data: command
            }));
        }
    }
}

// Initialize client
const client = new NeovimClient();

// Setup keyboard handlers immediately
client.setupKeyboardHandlers();

// Connect when page loads
window.addEventListener('load', () => {
    console.log('Page loaded, connecting...');
    client.connect();
});

// Make function globally accessible
window.connectToNeovim = function() {
    console.log('Connect button clicked');
    const addressInput = document.getElementById('nvim-address');
    if (!addressInput) {
        console.error('Address input not found');
        return;
    }
    
    const address = addressInput.value;
    console.log('Address value:', address);
    
    if (address.trim()) {
        client.connectToNeovim(address);
    } else {
        client.updateStatus('Please enter a valid address');
    }
};

