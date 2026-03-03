const handler = require('C:\\Users\\Kuzey\\Desktop\\hainkim\\netlify\\functions\\letterboxd.js').handler;

async function test() {
    console.time("fetch");
    try {
        const res = await handler({
            httpMethod: "GET",
            queryStringParameters: { username: "yunusariyer" }
        });
        console.timeEnd("fetch");
        console.log("Status:", res.statusCode);
        console.log("Body:", res.body.substring(0, 500) + "...");
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
