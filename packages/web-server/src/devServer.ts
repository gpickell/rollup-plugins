import FileServer from "./FileServer";

function devServer() {
    const spec = process.env.SPEC || process.argv[2];
    const { server, url } = FileServer.createServer(true, false, "dist", spec);
    server.on("listening", () => {
        if (url) {
            console.log("Dev Server: port =", url);
        } else {
            console.log("Dev Server: pipe =", url);
        }
    });
}

devServer();
