#!/bin/zsh
cd "$(dirname "$0")"
npm run server & 
npm run dev -- --host
