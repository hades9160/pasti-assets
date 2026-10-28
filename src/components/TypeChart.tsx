import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function TypeChart({ data }: { data: { name: string; full: string; count: number }[] }) {
  return (
    <div className="h-56" role="img" aria-label={data.map((b) => `${b.full}: ${b.count}`).join(', ')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="#2a2f3b" />
          <XAxis dataKey="name" tick={{ fill: '#8a92a6', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: '#8a92a6', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#1e222b', border: '1px solid #2a2f3b', borderRadius: 9, color: '#e7e9ef' }}
            labelFormatter={(_, p) => p?.[0]?.payload.full} formatter={(v) => [v, 'Assets']} />
          <Bar dataKey="count" fill="#4c7bf0" radius={[5, 5, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
