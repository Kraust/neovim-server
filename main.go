package main

import (
	"github.com/Kraust/nvim-server/server"
	"log"
)

func main() {
	err := server.Serve("127.0.0.1:9998")
	if err != nil {
		log.Fatalf("%s", err)
	}
}
