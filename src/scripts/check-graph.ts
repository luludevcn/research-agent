import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { buildGraph } from "../lib/graph/graph";
import Database from "better-sqlite3";
import path from "path";
import fs from "node:fs";

async function main() {

    const dataDir = path.resolve(process.cwd(), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "graph.db");

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    const cp = new SqliteSaver(db);

    // const cp = SqliteSaver.fromConnString("file:./graph.db");

    const graph = buildGraph();
    const compiled = graph.compile({checkpointer:cp});

    const config = {configurable:{thread_id:"t1"}};

    console.log("first running");

    const out = await compiled.invoke({question:"test question"},config);
    console.log(JSON.stringify(out));

    console.log("reading checkpointer (refuse to run)");
    const tuple = await cp.getTuple(config);
    console.log("checkpointer exists", !!tuple);

    console.log("second running");
    const out2 = await compiled.invoke({question:"test question second running"},config);
    console.log(JSON.stringify(out2));

    db.close();
    console.log("done, db: ", dbPath);
    
}

main().catch(e => {console.error(e); process.exit(1)});