import Link from "next/link";

const VARIANTS = [
  {
    slug: "dark",
    name: "Dark · Bordered",
    description:
      "Текущая палитра zinc, мягкие границы у карточек, hover-подсветка. Ближе всего к нынешнему UI, отполировано под новые требования.",
  },
  {
    slug: "airy",
    name: "Dark · Airy",
    description:
      "Та же тёмная палитра, но без рамок у карточек — больше воздуха, обложки доминируют, текст и кнопки парят на фоне.",
  },
  {
    slug: "light",
    name: "Light",
    description:
      "Светлая палитра — off-white фон, тёмный текст. Та же структура, чтобы посмотреть как тема работает в свету.",
  },
];

export default function PrototypesIndex() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-16 flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">UI prototypes</p>
          <h1 className="text-3xl font-semibold tracking-tight">Three minimalist variants</h1>
          <p className="text-sm text-zinc-400 max-w-xl">
            Большие квадратные обложки, явная кнопка Find similar и ссылка Open in. Без BPM/тональности — этих данных
            нет в пайплайне.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {VARIANTS.map((v) => (
            <Link
              key={v.slug}
              href={`/prototypes/${v.slug}`}
              className="group flex flex-col gap-2 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/40 p-4 transition-colors"
            >
              <h2 className="text-base font-medium text-zinc-50">{v.name}</h2>
              <p className="text-xs text-zinc-500 leading-relaxed">{v.description}</p>
              <span className="text-xs text-indigo-400 mt-2 group-hover:translate-x-0.5 transition-transform">
                Открыть →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
