"use client"

import { Card, KeyValueList, Table } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import { BAND_NAMES, FEE_BANDS, type FeeBand, type FeeSchedule } from "@/lib/services/fees"

import { bandClasses, formatShillings, INSTALMENTS } from "./format"

type Instalment = (typeof INSTALMENTS)[number]

// A year's schedule as read-only tables, for everyone who may read it.
export function ScheduleView({ schedule }: { schedule: FeeSchedule }) {
  return (
    <div className="fs-stack">
      <Card title="Annual school fees" titleId="fees-annual">
        <div className="fs-card-body">
          <Table<FeeBand>
            label="Fees by band"
            rows={[...FEE_BANDS]}
            rowKey={(band) => band}
            columns={[
              {
                header: "Band",
                cell: (band) => (
                  <span className="fs-band">
                    <b>{BAND_NAMES[band]}</b>
                    <small>{bandClasses(band)}</small>
                  </span>
                ),
              },
              { header: "Day (TZS)", align: "end", cell: (band) => formatShillings(schedule.bands[band].day) },
              { header: "Boarding (TZS)", align: "end", cell: (band) => formatShillings(schedule.bands[band].boarding) },
            ]}
          />
        </div>
      </Card>

      <Card title="Instalments" titleId="fees-instalments">
        <div className="fs-card-body">
          <Table<Instalment>
            label="Shares and due dates"
            rows={[...INSTALMENTS]}
            rowKey={([, key]) => key}
            columns={[
              { header: "Instalment", cell: ([label]) => label },
              { header: "Share", align: "end", cell: ([, key]) => `${schedule.split[key]}%` },
              { header: "Due", align: "end", cell: ([, key]) => formatDate(schedule.dueDates[key]) },
            ]}
          />
        </div>
      </Card>

      <Card title="Deposit and programmes" titleId="fees-other">
        <div className="fs-card-body">
          <KeyValueList
            className="fs-kv-end"
            items={[
              { key: "Minimum Initial deposit", value: `TZS ${formatShillings(schedule.minimumDeposit)}`, numeric: true },
              { key: "Pre-Form One programme, Day", value: `TZS ${formatShillings(schedule.preFormOne.day)}`, numeric: true },
              { key: "Pre-Form One programme, Boarding", value: `TZS ${formatShillings(schedule.preFormOne.boarding)}`, numeric: true },
            ]}
          />
        </div>
      </Card>
    </div>
  )
}
