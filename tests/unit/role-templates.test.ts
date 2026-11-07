import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { PERMISSIONS, RESERVED_PERMISSIONS } from "@/lib/permissions"
import { ROLE_TEMPLATES, roleTemplate, templateLinks } from "@/lib/role-templates"

// The five templates the Super Admin creates roles from (#241).

describe("the role templates", () => {
  it("are the five the owner named, in order", () => {
    expect(ROLE_TEMPLATES.map((t) => t.name)).toEqual([
      "Admissions Staff",
      "Admissions Manager",
      "Accountant",
      "Head Accountant",
      "Administrator",
    ])
  })

  it("name only permissions from lib/permissions.ts, never a reserved one, each once", () => {
    for (const template of ROLE_TEMPLATES) {
      for (const permission of template.permissions) {
        expect(PERMISSIONS, template.name).toContain(permission)
        expect(RESERVED_PERMISSIONS, template.name).not.toContain(permission)
      }
      expect(new Set(template.permissions).size, template.name).toBe(template.permissions.length)
    }
  })

  it("manage only other templates", () => {
    const names = ROLE_TEMPLATES.map((t) => t.name)
    for (const template of ROLE_TEMPLATES) {
      for (const managed of template.manages) {
        expect(names, template.name).toContain(managed)
        expect(managed, template.name).not.toBe(template.name)
      }
    }
  })

  it("give each managing template the set the owner decided", () => {
    expect(Object.fromEntries(ROLE_TEMPLATES.map((t) => [t.name, t.manages]))).toEqual({
      "Admissions Staff": [],
      "Admissions Manager": ["Admissions Staff"],
      Accountant: [],
      "Head Accountant": ["Accountant"],
      Administrator: ["Admissions Manager", "Head Accountant"],
    })
  })

  it("match the three roles the local seed recreates", () => {
    const seed = readFileSync("supabase/seeds/00_base.sql", "utf8")
    for (const name of ["Admissions Staff", "Admissions Manager", "Accountant"]) {
      const row = new RegExp(`'${name}', array\\[([^\\]]*)\\]`).exec(seed)
      expect(row, name).not.toBeNull()
      const seeded = [...row![1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
      expect(seeded, name).toEqual([...roleTemplate(name)!.permissions].sort())
    }
  })
})

describe("templateLinks", () => {
  const roles = [
    { id: "staff", name: "Admissions Staff", retired: false },
    { id: "manager", name: "admissions manager", retired: false },
    { id: "accountant", name: "Accountant", retired: true },
    { id: "admin", name: "Administrator", retired: false },
  ]

  it("manages the current roles named in the template, and joins the sets of the current roles whose template manages it", () => {
    expect(templateLinks(roleTemplate("Admissions Manager")!, roles)).toEqual({ manages: ["staff"], managedBy: ["admin"] })
    expect(templateLinks(roleTemplate("Admissions Staff")!, roles)).toEqual({ manages: [], managedBy: ["manager"] })
  })

  it("leaves out retired roles and roles that don't exist yet", () => {
    expect(templateLinks(roleTemplate("Head Accountant")!, roles)).toEqual({ manages: [], managedBy: ["admin"] })
    expect(templateLinks(roleTemplate("Accountant")!, roles)).toEqual({ manages: [], managedBy: [] })
  })
})
