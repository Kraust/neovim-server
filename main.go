package main

import (
	"flag"
	"github.com/Kraust/nvim-server/server"
	"log"
)

var (
	f_address = flag.String("address", "127.0.0.1:9998", "Specifies the address to bind the server to.")
)

func main() {
	flag.Parse()
	err := server.Serve(*f_address)
	if err != nil {
		log.Fatalf("%s", err)
	}
}
