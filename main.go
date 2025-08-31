package main

import (
	"flag"
	"fmt"
	"github.com/Kraust/nvim-server/server"
	"log"
	"os"
)

var (
	version = "dev"

	f_address = flag.String("address", "127.0.0.1:9998", "Specifies the address to bind the server to.")
	f_version = flag.Bool("version", false, "Show version information and exit.")
)

func main() {
	flag.Parse()

	if *f_version {
		fmt.Printf("nvim-server %s\n", version)
		os.Exit(0)
	}

	err := server.Serve(*f_address)
	if err != nil {
		log.Fatalf("%s", err)
	}
}
