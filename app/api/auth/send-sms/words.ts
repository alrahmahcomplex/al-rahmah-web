// The reset SMS (#503, O-N46), in Swahili: the hook doesn't know the page's
// language, and the Discount code pages put Swahili first. It fits one SMS.
export function resetSms(otp: string): string {
  return `Al-Rahmah Complex: namba yako ya kuweka nenosiri jipya ni ${otp}. Inaisha baada ya dakika 10. Usimpe mtu yeyote, hata ofisi.`
}
