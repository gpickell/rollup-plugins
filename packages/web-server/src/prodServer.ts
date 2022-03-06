import FileServer from "./FileServer";

function devServer() {
    const spec = process.env.SPEC || process.argv[2];
    const { server, url } = FileServer.createServer(false, true, "dist", spec);
    server.on("listening", () => {
        if (url) {
            console.log("Prod Server: port =", url);
        } else {
            console.log("Prod Server: pipe =", url);
        }
    });
}

devServer();
