# Mossy Depths multiplayer server

Files: server.js (relay), package.json, public/index.html (the game).

## Test on your PC
1. Install Node.js (18+).
2. In this folder: npm install, then npm start
3. Open http://localhost:3000 in two tabs. Use PARTY to invite, then enter the gate.

## Put it online (free): Render.com
1. Upload this folder to a GitHub repo.
2. Render -> New -> Web Service -> pick the repo.
3. Build command: npm install   Start command: npm start
4. Send friends the https://YOURNAME.onrender.com link. No account needed.
   Free plan sleeps when idle: the first load can take about a minute.

## Private rooms
Add ?room=NAME to the link, e.g. https://YOURNAME.onrender.com/?room=andrew-and-friends
Without it everyone joins the room "lobby". Max 8 players per room.
