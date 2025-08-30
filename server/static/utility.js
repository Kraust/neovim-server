function getUrlParameter(name) {
	const urlParams = new URLSearchParams(window.location.search);
	return urlParams.get(name);
}

function isValidServerAddress(address) {
	const pattern = /^[a-zA-Z0-9.-]+:\d+$/;
	return pattern.test(address);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { getUrlParameter, isValidServerAddress };
}
