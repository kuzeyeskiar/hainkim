const https = require("https");
const cheerio = require("cheerio");

// Multiple proxy options for reliability
const PROXIES = [
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

function fetchRaw(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout: 12000,
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const loc = res.headers.location;
                if (loc) return fetchRaw(loc).then(resolve).catch(reject);
            }
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    });
}

async function fetchPage(targetUrl) {
    // Try each proxy
    for (const makeProxy of PROXIES) {
        try {
            const proxyUrl = makeProxy(targetUrl);
            const { status, body } = await fetchRaw(proxyUrl);

            // Check if we got Cloudflare challenge or error
            if (body.includes("Just a moment") || body.includes("cf-browser-verification")) {
                continue; // Try next proxy
            }

            if (status === 404 || body.includes("Page Not Found")) {
                throw new Error("Kullanici bulunamadi");
            }

            if (status >= 200 && status < 300 && body.length > 500) {
                return body;
            }
        } catch (err) {
            if (err.message.includes("bulunamadi")) throw err;
            // Try next proxy
            continue;
        }
    }

    // Last resort: direct fetch (might work for profile pages)
    try {
        const { status, body } = await fetchRaw(targetUrl);
        if (status === 404) throw new Error("Kullanici bulunamadi");
        if (status === 200 && body.length > 500) return body;
        throw new Error("HTTP " + status);
    } catch (err) {
        throw err;
    }
}

function parseUserList(html) {
    const $ = cheerio.load(html);
    const users = [];
    const seen = new Set();
    const skip = new Set([
        "films", "lists", "journal", "members", "activity",
        "following", "followers", "search", "settings", "about",
    ]);

    // Primary: table-person cells
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

    // Fallback
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

async function fetchAllPages(username, type) {
    const allUsers = [];
    for (let page = 1; page <= 15; page++) {
        const url = `https://letterboxd.com/${username}/${type}/page/${page}/`;
        try {
            const html = await fetchPage(url);
            const users = parseUserList(html);
            if (users.length === 0) break;
            allUsers.push(...users);

            const $ = cheerio.load(html);
            const hasNext = $('a.next, .paginate-next, [rel="next"]').length > 0;
            if (!hasNext) break;

            await new Promise((r) => setTimeout(r, 300));
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
        // Verify user exists
        const profileHtml = await fetchPage("https://letterboxd.com/" + username + "/");
        const profile = parseProfile(profileHtml, username);

        // Fetch following and followers in parallel
        const [following, followers] = await Promise.all([
            fetchAllPages(username, "following"),
            fetchAllPages(username, "followers"),
        ]);

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
