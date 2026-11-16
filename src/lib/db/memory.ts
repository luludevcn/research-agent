import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
export const prisma = new PrismaClient({ adapter });

export type NoteInput = {
    url: string,
    title?: string,
    snippet: string,
    from: "search" | "fetch",
    subTaskId?: string
}

export async function createTask(question: string, plan: unknown) {
    return prisma.task.create({
        data: {
            question,
            plan: JSON.stringify(plan)
        }
    })
}

export async function saveNotes(taskId: string, notes?: NoteInput[]) {
    if (!notes?.length) return;

    const existing = await prisma.note.findMany({
        where: { taskId },
        select: { url: true }
    });
    const seen = new Set<string>();
    existing.forEach(note => seen.add(note.url));
    const data = notes.filter(n => n.url && !seen.has(n.url) && (seen.add(n.url), true)).map(n => ({
        url: n.url,
        title: n.title,
        snippet: n.snippet.slice(0, 1000),
        from: n.from,
        subTaskId: n.subTaskId,
        taskId
    }))
    if (data.length) await prisma.note.createMany({ data });
}

export async function getNotes(taskId: string) {
    return prisma.note.findMany({where: {taskId}, orderBy: {createAt: "asc"}})
}

export async function saveReport(taskId: string, report: string) {
    return prisma.task.update({
        where: {id: taskId},
        data: {report}
    })
}