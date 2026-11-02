import { localTools } from "../lib/tools/registry";

async function main() {
    const search = localTools.find(t => t.name === "web_search");
    console.log("web search parameters schema:", search?.parameters);

    const r1 = await search?.execute({query: "the best language to learn in 2026", maxResults: 3});
    console.log("web search result:", r1);

    const url = r1.results?.[0]?.url;
    if(url) {
        const fetch = localTools.find(t => t.name === "fetch_url");
        console.log("fetch url parameters schema:", fetch?.parameters);
        const r2 = await fetch?.execute({url});
        console.log("fetch url result:", r2);
    }
    console.log("done");
}

main().catch((err) => { console.error(err); process.exit(1); });