const https = require("https");

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return reject(new Error("Kullanici bulunamadi"));
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseUserList(html) {
  const users = [];
  const regex = /href="\/([\w-]+)\/"[^>]*>\s*(?:<img[^>]*>)?\s*<\/[^>]+>\s*<[^>]+>\s*<[^>]+>\s*<a[^>]*>([^<]+)<\/a>/gi;
  
  // Simpler approach: extract all /username/ links from person cards
  const cardRegex = /<td class="table-person"[\s\S]*?<a href="\/([\w-]+)\/"[\s\S]*?class="[^"]*name[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const username = match[1].toLowerCase();
    const displayName = match[2].trim();
    if (username && !["films","lists","journal","members","activity","following","followers"].includes(username)) {
      users.push({ username, displayName });
    }
  }

  // Fallback: grab all linked usernames from the people list
  if (users.length === 0) {
    const fallback = /<a href="\/([\w-]+)\/" class="[^"]*avatar[^"]*"/gi;
    while ((match = fallback.exec(html)) !== null) {
      const username = match[1].toLowerCase();
      if (!["films","lists","journal","members","activity"].includes(username)) {
        users.push({ username, displayName: username });
      }
    }
  }

  const seen = new Set();
  return users.filter((u) => {
    if (seen.has(u.username)) return false;
    seen.add(u.username);
    return true;
  });
}

async function fetchAllPages(username, type) {
  const allUsers = [];
  for (let page = 1; page <= 20; page++) {
    const url = "https://letterboxd.com/" + username + "/" + type + "/page/" + page + "/";
    try {
      const html = await fetchPage(url);
      const users = parseUserList(html);
      if (users.length === 0) break;
      allUsers.push(...users);
      const hasNext = html.includes('rel="next"') || html.includes('"next"');
      if (!hasNext) break;
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
  }
  return allUsers;
}

function parseProfile(html, username) {
  const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const displayName = nameMatch ? nameMatch[1].replace(" on Letterboxd","").replace("  Letterboxd","").trim() : username;
  const filmMatch = html.match(/(\d[\d,]+)\s*films?/i);
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
    const [profileHtml, following, followers] = await Promise.all([
      fetchPage("https://letterboxd.com/" + username + "/"),
      fetchAllPages(username, "following"),
      fetchAllPages(username, "followers"),
    ]);

    const profile = parseProfile(profileHtml, username);
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
    return {
      statusCode: err.message.includes("bulunamadi") ? 404 : 500,
      headers,
      body: JSON.stringify({ error: err.message || "Bir hata olustu" }),
    };
  }
};
