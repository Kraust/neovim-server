// Global client instance
const client = new NeovimClient();
window.client = client;

// Setup keyboard handlers
client.setupKeyboardHandlers();

// Window load handler
window.addEventListener("load", () => {
	client.connect();

	const serverAddress = getUrlParameter("server");
	if (serverAddress && isValidServerAddress(serverAddress)) {
		const connectionForm = document.getElementById("connection-form");
		if (connectionForm) {
			connectionForm.style.opacity = "0.5";
		}

		const addressInput = document.getElementById("nvim-address");
		if (addressInput) {
			addressInput.value = decodeURIComponent(serverAddress);
		}

		setTimeout(() => {
			client.updateStatus("Auto-connecting to " + serverAddress + "...");
			client.updateTitle(serverAddress + " (connecting...)");
			client.updateFavicon("default");
			client.connectToNeovim(decodeURIComponent(serverAddress));
		}, 500);
	}
});

// Terminal event handlers
const terminal = document.getElementById("terminal");

terminal.addEventListener("keyup", (event) => {
	if (!client.connected) return;
});

terminal.addEventListener("paste", (event) => {
	if (!client.connected) return;

	event.preventDefault();
	const text = event.clipboardData.getData("text");
	client.sendInput(text);
});

// Global connection function
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
