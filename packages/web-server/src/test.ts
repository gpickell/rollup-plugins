import FileServer from "./FileServer";
import http from "http";

function setup() {
    const fs = new FileServer();
    fs.serveTrack("/", "static");
    fs.serveWatch("/", "static", "hot");
    fs.serveFiles("/", "static", "/");
    fs.log = true;

    const server = http.createServer();
    server.on("request", req => {
        console.log("---", req.url);
    });

    server.on("request", fs.process);

    server.on("listening", () => {
        console.log("---", server.address());
    });

    server.listen(7180, "localhost");
}

setup();