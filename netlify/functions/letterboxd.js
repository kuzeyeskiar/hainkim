const { gotScraping } = require("got-scraping");
const cheerio = require("cheerio");

async function fetchPage(url) {
  const res = await gotScraping({
    url,
    headerGeneratorOptions: {
      browsers: [{ name: "chrome", minVersion: 120 }],
      devices: ["desktop"],
      operatingSystems: ["windows"],
    },
    timeout: { request: 20000 },
    followRedirect: true,
    maxRedirects: 5,
  });

  if (res.statusCode === 404) throw new Error("Kullanici bulunamadi");
  if (res.statusCode === 403) throw new Error("HTTP 403");
  if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);

  return res.body;
}

function parseUserList(html) {
  const $ = cheerio.load(html);
  const users = [];
  const seen = new Set();
  const skip = new Set(["films", "lists", "journal", "members", "activity", "following", "followers", "search", "settings", "about"]);

  // Primary: table-person cells with name links
  $("td.table-person").each((_, td) => {
    const $nameLink = $(td).find("a.name");
    if ($nameLink.length) {
      const href = $nameLink.attr("href") || "";
      const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
      if (m) {
        const username = m[1].toLowerCase();
        const displayName = $nameLink.text().trim() || username;
        if (!seen.has(username) && !skip.has(username)) {
          seen.add(username);
          users.push({ username, displayName });
        }
      }
    }
  });

  // Fallback: avatar links in person-summary sections
  if (users.length === 0) {
    $("a.avatar, .person-summary a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/^\/([a-z0-9_-]+)\/$/i);
      if (m) {
        const username = m[1].toLowerCase();
        if (!seen.has(username) && !skip.has(username)) {
          seen.add(username);
          users.push({ username, displayName: username });
        }
      }
    });
  }

  return users;
}

async function fetchAllPages(username, type) {
  const allUsers = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://letterboxd.com/${username}/${type}/page/${page}/`;
    try {
      const html = await fetchPage(url);
      const users = parseUserList(html);
      if (users.length === 0) break;
      allUsers.push(...users);

      const $ = cheerio.load(html);
      const hasNext = $('a.next, .paginate-next, [rel="next"]').length > 0;
      if (!hasNext) break;

      // Rate limiting - be respectful
      await new Promise((r) => setTimeout(r, 400));
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

  const username =
    event.queryStringParameters && event.queryStringParameters.username
      ? event.queryStringParameters.username.toLowerCase().trim()
      : null;

  if (!username || !/^[a-z0-9_-]+$/i.test(username)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Gecersiz kullanici adi" }),
    };
  }

  try {
    // First fetch profile to verify user exists
    const profileHtml = await fetchPage("https://letterboxd.com/" + username + "/");
    const profile = parseProfile(profileHtml, username);

    // Then fetch following and followers in parallel
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
