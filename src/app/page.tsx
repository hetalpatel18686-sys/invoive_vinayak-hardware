
import Link from 'next/link'
export default function Home(){
  return (
    <div className="card">
      <h1 className="text-xl font-semibold mb-2">Welcome</h1>
      <p>Go to <Link className="text-primary" href="/customers">Customers</Link> or <Link className="text-primary" href="/items">Items</Link>.</p>
    </div>
  )
}
