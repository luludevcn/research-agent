import type {Note} from "@prisma/client";


export function buildSourceList(notes:Note[]):string {
    return notes.map((n,i)=> `[${i+1}] ${n.title} ${n.url} ${n.snippet}}`).join('\n\n')
}

export function normalizeCitation(report: string, notes: Note[]){ 
    const valid = new Set<Number>();
    notes.forEach((_, i) => valid.add(i+1));

    const used = new Set<Number>();
    const cleaned = report.replace(/\[\d+\]/g, (m,s) => {
        const n = Number(s);
        if(!valid.has(n)) return "";
        used.add(n);
        return `[${n}]`
    })

    const cited = used.size? Array.from(used).sort((a,b)=>a - b) : Array.from(valid);
    const refs = cited.map((n)=>{
        const note = notes[n-1];;
        return `[${n}] ${note.title} ${note.url}`
    })
    .join('\n')

    const final = `${cleaned.trim()}\n\n## 参考文献\n${refs}`;
    return {report: final, citedCount: cited.length, usedCount: used.size};
}