import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** A picture of an address, for a phone's camera: built by the QR library from our own data only. */
export function useQrPicture(address: string | null): string {
  const [picture, setPicture] = useState('')
  useEffect(() => {
    if (!address) return
    let alive = true
    void QRCode.toString(address, { type: 'svg', margin: 1, color: { dark: '#06181c', light: '#eef6f4' } }).then((svg) => {
      if (alive) setPicture(svg)
    })
    return () => {
      alive = false
    }
  }, [address])
  return picture
}
