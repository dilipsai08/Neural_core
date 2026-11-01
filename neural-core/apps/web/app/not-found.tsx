import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ display: "grid", placeItems: "center", height: "100vh", textAlign: "center", gap: "var(--s-3)" }}>
      <div>
        <p className="label">Dead line</p>
        <h1 style={{ fontSize: "var(--fs-2xl)", margin: "var(--s-2) 0 var(--s-4)" }}>Nothing on this circuit</h1>
        <Link href="/" style={{ color: "var(--volt)" }}>
          Back to Substation 07
        </Link>
      </div>
    </main>
  );
}
