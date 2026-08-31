export function PlotSeriesSelector({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (selected: string[]) => void }) {
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);
  return <details className="plot-series-selector"><summary>{selected.length ? `${selected.length} selected` : "Select values"}</summary><div>{options.map((name) => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />{name}</label>)}</div></details>;
}
