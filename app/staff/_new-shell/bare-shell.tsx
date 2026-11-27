import Image from "next/image"
import type { ReactNode } from "react"

import "./new-shell.css"

/**
 * The shell with nothing to go to yet (design site, prototype v6): the white
 * frame, the brand in the top bar where the toggle and search would be, and
 * the outlined stage with its page centred. For a page shown before anyone
 * may go further, such as the design site's lock screen. Static: no session,
 * no cookies.
 */
export function BareShell({ brandSubtitle, children }: { brandSubtitle: string; children: ReactNode }) {
  return (
    <div className="ns" data-shell="new" data-bare="">
      <div className="ns-main">
        <header className="ns-tb">
          <div className="ns-brand">
            <Image className="ns-logo" src="/brand/logo-round.png" alt="" width={36} height={36} priority />
            <div className="ns-name">
              <b>Al-Rahmah Complex</b>
              <small>{brandSubtitle}</small>
            </div>
          </div>
        </header>
        <div className="ns-stage">
          <div className="ns-scroll" data-stage-scroll="">
            <main className="ns-page ns-page-centre">{children}</main>
          </div>
        </div>
      </div>
    </div>
  )
}
