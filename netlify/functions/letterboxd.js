const http2 = require("http2");
const cheerio = require("cheerio");

function fetchPage(client, url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const headers = {
            ":method": "GET",
            ":path": parsed.pathname + parsed.search,
            ":authority": parsed.host,
            ":scheme": "https",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-language": "en-US,en;q=0.9",
            "accept-encoding": "identity",
            "cache-control": "max-age=0",
            "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
        };

        const req = client.request(headers);
        req.setEncoding("utf8");

        let status = 0;
        let data = "";
        let location = "";

        req.on("response", (resHeaders) => {
            status = resHeaders[":status"];
            location = resHeaders["location"] || "";
        });

        req.on("data", (chunk) => { data += chunk; });

        req.on("end", () => {
            if ((status === 301 || status === 302) && location) {
                const redirectUrl = location.startsWith("http")
                    ? location
                    : `https://${parsed.host}${location}`;
                return fetchPage(client, redirectUrl).then(resolve).catch(reject);
            }

            if (status === 404) return reject(new Error("Kullanici bulunamadi"));
            if (status === 403) return reject(new Error("HTTP 403"));
            if (status !== 200) return reject(new Error("HTTP " + status));

            resolve(data);
        });

        req.on("error", (err) => {
            reject(err);
        });

        req.setTimeout(15000, () => {
            req.close();
            reject(new Error("Timeout"));
        });

        req.end();
    });
}

function parseUserList(html) {
    const $ = cheerio.load(html);
    const users = [];
    const seen = new Set();
    const skip = new Set([
        "films", "lists", "journal", "members", "activity",
        "following", "followers", "search", "settings", "about",
    ]);

    $("td.table-person").each((_, td) => {
        const $nameLink = $(td).find("a.name");
        if ($nameLink.length) {
            const href = $nameLink.attr("href") || "";
            const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
            if (m) {
                const u = m[1].toLowerCase();
                const d = $nameLink.text().trim() || u;
                if (!seen.has(u) && !skip.has(u)) { seen.add(u); users.push({ username: u, displayName: d }); }
            }
        }
    });

    if (users.length === 0) {
        $("a.avatar, .person-summary a[href]").each((_, a) => {
            const href = $(a).attr("href") || "";
            const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
            if (m) {
                const u = m[1].toLowerCase();
                if (!seen.has(u) && !skip.has(u)) { seen.add(u); users.push({ username: u, displayName: u }); }
            }
        });
    }

    return users;
}

async function fetchAllPages(client, username, type) {
    const allUsers = [];
    for (let page = 1; page <= 200; page++) {
        const url = `https://letterboxd.com/${username}/${type}/page/${page}/`;
        try {
            const html = await fetchPage(client, url);
            const users = parseUserList(html);
            if (users.length === 0) break;
            allUsers.push(...users);

            const $ = cheerio.load(html);
            const hasNext = $('a.next, .paginate-next, [rel="next"]').length > 0;
            if (!hasNext) break;
        } catch (err) {
            if (page === 1) throw err;
            break;
        }
    }
    return allUsers;
}

function parseProfile(html, username) {
    const $ = cheerio.load(html);
    const ogTitle = $('meta[property="og:title"]').attr("content") || "";
    const displayName = ogTitle
        .replace(/ on Letterboxd/i, "")
        .replace(/\s+Letterboxd/i, "")
        .trim() || username;
    const bodyText = $("body").text();
    const filmMatch = bodyText.match(/(\d[\d,]+)\s*films?/i);
    const films = filmMatch ? filmMatch[1] : "?";
    return { displayName, films };
}

exports.handler = async (event) => {
    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const username = event.queryStringParameters && event.queryStringParameters.username
        ? event.queryStringParameters.username.toLowerCase().trim()
        : null;

    if (!username || !/^[a-z0-9_-]+$/i.test(username)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Gecersiz kullanici adi" }) };
    }

    try {
        const client = http2.connect("https://letterboxd.com");
        client.on("error", (err) => {
            console.error("HTTP/2 Client Error:", err);
        });

        // Add a safety timeout to close the client if everything hangs
        const maxTimeout = setTimeout(() => {
            if (!client.closed) client.close();
        }, 24000); // 24 seconds (Netlify limit is 26s)

        const profileHtml = await fetchPage(client, "https://letterboxd.com/" + username + "/");
        const profile = parseProfile(profileHtml, username);

        const [following, followers] = await Promise.all([
            fetchAllPages(client, username, "following"),
            fetchAllPages(client, username, "followers"),
        ]);

        clearTimeout(maxTimeout);
        if (!client.closed) client.close();

        const followerSet = new Set(followers.map((f) => f.username));
        const followingSet = new Set(following.map((f) => f.username));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                username,
                displayName: profile.displayName,
                films: profile.films,
                followingCount: following.length,
                followersCount: followers.length,
                notFollowingBack: following.filter((f) => !followerSet.has(f.username)),
                mutual: following.filter((f) => followerSet.has(f.username)),
                notFollowing: followers.filter((f) => !followingSet.has(f.username)),
            }),
        };
    } catch (err) {
        const msg = err.message || "Bir hata olustu";
        return {
            statusCode: msg.includes("bulunamadi") ? 404 : 500,
            headers,
            body: JSON.stringify({ error: msg }),
        };
    }
};
