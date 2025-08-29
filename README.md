# neovim-server

## Introduction

This is a Proof of Concept for a Neovim Server that I've mainly vibe coded.
Once I have a working model I plan on doing a better implementation. This is
loosely based on the concept presented by 
[Code Server](https://github.com/coder/code-server).

## Project Goals

Since ~2019 I have wanted a remote ui for Neovim that can be rendered in
the browser. While there are similar options (such as 
[Firenvim](https://github.com/glacambre/firenvim)) none of them meet my
requirements.

- Go Based Backend
- Simple frontend that allows for connecting to a remote neovim instance e.g.
with `nvim --headless --listen 127.0.0.1:6666`
- [Glowing Bear](https://glowing-bear.org/) like approach to remote clients.

## Why start off with Vibe Coding?

- I am not a web developer (My background is in systems programming,
driver development, and backend)
- I wanted to see if I could leverage an AI to see how fast I could generate
a working PoC for a project I have been sitting on for over half of a decade.

## Why would you ever use this?

I wrote a couple of blog posts about neovim as a service, but never finished 
the series:
- [Remote Neovim for Dummies](https://kraust.github.io/posts/remote-neovim-for-dummies/)
- [Neovim is a Multiplexer](https://kraust.github.io/posts/neovim-is-a-multiplexer/)

## Is this secure?

- The plan is to eventually be secure. Because the client runs over HTTP, traffic
 can be shipped over HTTPs to the backend, and you can bring your own security for 
 the backend connection from the server to your neovim client.


