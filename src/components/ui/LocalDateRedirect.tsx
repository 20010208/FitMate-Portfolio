'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

function makeDateId(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export default function LocalDateRedirect({ basePath }: { basePath: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(`${basePath}?date=${makeDateId(new Date())}`)
  }, [router, basePath])
  return null
}
