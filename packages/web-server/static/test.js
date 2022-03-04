async function test() {
    const req = await fetch("./hot/", {
        method: "POST",
        headers: {
            accept: "application/json; watch"
        }
    });

    console.log("--- ?");
}

test();
