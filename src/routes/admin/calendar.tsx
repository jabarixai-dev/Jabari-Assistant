import { createFileRoute } from "@tanstack/react-router"
import { AppointmentsCalendar } from "../../components/appointments-calendar"
import { BookingManager } from "../../components/booking-manager"
export const Route = createFileRoute("/admin/calendar")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Calendar</h1><p className="mt-1 text-sm text-white/45">Appointments, booking types and scheduled meetings.</p></div><AppointmentsCalendar /><BookingManager /></div> })
