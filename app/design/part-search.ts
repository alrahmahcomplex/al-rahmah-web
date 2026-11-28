"use client"

import { createContext, useContext } from "react"

/** What the design site's top bar search holds; the Design system page shows only the parts it matches. */
export const PartSearch = createContext<string>("")

export const usePartSearch = () => useContext(PartSearch)
