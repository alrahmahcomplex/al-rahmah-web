import Image from "next/image"
import Link from "next/link"

// Placeholder until the School Landing Page ticket fills this in.
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-blue-100 via-blue-100/50 to-white p-8">
      <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={140} height={140} priority />
      <h1 className="text-blue-600 font-exo font-extrabold italic text-3xl">Al-Rahmah Complex</h1>
      <Link href="/login" className="text-orange-600 font-exo font-bold italic underline-offset-4 hover:underline">
        Staff sign-in
      </Link>
    </main>
  )
}
