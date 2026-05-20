# BarberShop Booking App — Project Context

## Stack
- Backend: Node/Express, MongoDB/Mongoose, JWT auth, Stripe
- Frontend: React 18, React Router v6
- Fonts: Cormorant Garamond (headings) + Outfit (body)
- Colors: gold #c9a84c, charcoal #1a1a2e, off-white #fafaf8
- Working branch: beef

## Start command
Run .bat file → option 3 (starts both servers)
- Backend: localhost:5000
- Frontend: localhost:3000

## Current task
Add a **Calendar tab** to the Provider Dashboard (`client/src/pages/ProviderDashboard.js`).

## What to build — Calendar tab

### Where to add it
In `ProviderDashboard.js`, the tabs section has:
- Appointment tabs: `['pending', 'confirmed', 'completed', 'cancelled']`
- Special tabs on the right: `['services', 'availability', 'earnings']`

Add `'calendar'` to the special tabs array so it becomes:
`['calendar', 'services', 'availability', 'earnings']`

Label it `'📅 Calendar'` in the tab button.

### Calendar state to add
```javascript
const [currentDate, setCurrentDate] = useState(new Date());
const [calendarView, setCalendarView] = useState('month'); // 'month' or 'week'
const [selectedDay, setSelectedDay] = useState(null);
```

### Calendar helper functions to add
```javascript
const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
};

const getAppointmentsForDay = (day) => {
    if (!day) return [];
    return appointments.filter(a => {
        const d = new Date(a.appointmentDate);
        return (
            d.getDate() === day &&
            d.getMonth() === currentDate.getMonth() &&
            d.getFullYear() === currentDate.getFullYear()
        );
    });
};

const getWeekDays = (date) => {
    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
};

const getAppointmentsForDate = (date) => {
    return appointments.filter(a => {
        const d = new Date(a.appointmentDate);
        return (
            d.getDate() === date.getDate() &&
            d.getMonth() === date.getMonth() &&
            d.getFullYear() === date.getFullYear()
        );
    });
};

const statusCalendarColors = {
    pending:   { bg: '#FAC775', text: '#633806' },
    confirmed: { bg: '#B5D4F4', text: '#0C447C' },
    completed: { bg: '#C0DD97', text: '#27500A' },
    cancelled: { bg: '#F7C1C1', text: '#791F1F' },
};
```

### Calendar tab JSX
Add this block after the earnings tab block and before the closing `</div>` of the container:

```jsx
{/* Calendar tab */}
{activeTab === 'calendar' && (
    <div>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                    onClick={() => {
                        const d = new Date(currentDate);
                        calendarView === 'month' ? d.setMonth(d.getMonth() - 1) : d.setDate(d.getDate() - 7);
                        setCurrentDate(d);
                        setSelectedDay(null);
                    }}
                    style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '1rem' }}
                >←</button>
                <h2 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>
                    {calendarView === 'month'
                        ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                        : `Week of ${getWeekDays(currentDate)[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    }
                </h2>
                <button
                    onClick={() => {
                        const d = new Date(currentDate);
                        calendarView === 'month' ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 7);
                        setCurrentDate(d);
                        setSelectedDay(null);
                    }}
                    style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '1rem' }}
                >→</button>
                <button
                    onClick={() => { setCurrentDate(new Date()); setSelectedDay(null); }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.875rem', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif', color: 'var(--text-secondary)' }}
                >Today</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['month', 'week'].map(v => (
                    <button key={v} onClick={() => { setCalendarView(v); setSelectedDay(null); }} style={{
                        padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid',
                        borderColor: calendarView === v ? 'var(--gold)' : 'var(--border)',
                        background: calendarView === v ? 'rgba(201,168,76,0.1)' : 'white',
                        color: calendarView === v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                        fontSize: '0.8rem', fontWeight: calendarView === v ? '600' : '400',
                        cursor: 'pointer', fontFamily: 'Outfit, sans-serif', textTransform: 'capitalize',
                    }}>{v}</button>
                ))}
            </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: selectedDay !== null ? '1fr 300px' : '1fr', gap: '1.5rem', alignItems: 'start' }}>

            {/* Month view */}
            {calendarView === 'month' && (
                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    {/* Day headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)', background: 'var(--warm-gray)' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} style={{ padding: '0.6rem', textAlign: 'center', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{d}</div>
                        ))}
                    </div>
                    {/* Day cells */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                        {getDaysInMonth(currentDate).map((day, i) => {
                            const dayAppts = getAppointmentsForDay(day);
                            const today = new Date();
                            const isToday = day && today.getDate() === day && today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear();
                            const isSelected = selectedDay === day;
                            return (
                                <div
                                    key={i}
                                    onClick={() => day && setSelectedDay(isSelected ? null : day)}
                                    style={{
                                        minHeight: '90px', padding: '6px',
                                        borderRight: '1px solid var(--border)',
                                        borderBottom: '1px solid var(--border)',
                                        background: isSelected ? 'rgba(201,168,76,0.06)' : day ? 'white' : 'var(--warm-gray)',
                                        cursor: day ? 'pointer' : 'default',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => { if (day && !isSelected) e.currentTarget.style.background = 'var(--warm-gray)'; }}
                                    onMouseLeave={e => { if (day && !isSelected) e.currentTarget.style.background = 'white'; }}
                                >
                                    {day && (
                                        <>
                                            <div style={{
                                                width: '24px', height: '24px', borderRadius: '50%',
                                                background: isToday ? 'var(--gold)' : 'transparent',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.78rem', fontWeight: isToday ? '700' : '400',
                                                color: isToday ? 'var(--charcoal)' : 'var(--text-secondary)',
                                                marginBottom: '4px',
                                            }}>{day}</div>
                                            {dayAppts.slice(0, 2).map((a, j) => {
                                                const c = statusCalendarColors[a.status] || statusCalendarColors.pending;
                                                return (
                                                    <div key={j} style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '3px', marginBottom: '2px', background: c.bg, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {a.startTime} {a.service?.name}
                                                    </div>
                                                );
                                            })}
                                            {dayAppts.length > 2 && (
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '1px 5px' }}>+{dayAppts.length - 2} more</div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Week view */}
            {calendarView === 'week' && (
                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid var(--border)', background: 'var(--warm-gray)' }}>
                        <div style={{ padding: '0.6rem' }} />
                        {getWeekDays(currentDate).map((d, i) => {
                            const today = new Date();
                            const isToday = d.toDateString() === today.toDateString();
                            return (
                                <div key={i} style={{ padding: '0.6rem', textAlign: 'center', borderLeft: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {d.toLocaleDateString('en-US', { weekday: 'short' })}
                                    </div>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isToday ? 'var(--gold)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '2px auto 0', fontSize: '0.85rem', fontWeight: isToday ? '700' : '400', color: isToday ? 'var(--charcoal)' : 'var(--text-secondary)' }}>
                                        {d.getDate()}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Hour rows */}
                    {Array.from({ length: 12 }, (_, h) => h + 7).map(hour => (
                        <div key={hour} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid var(--border)', minHeight: '56px' }}>
                            <div style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--text-muted)', borderRight: '1px solid var(--border)', paddingTop: '6px' }}>
                                {hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`}
                            </div>
                            {getWeekDays(currentDate).map((d, di) => {
                                const dayAppts = getAppointmentsForDate(d).filter(a => {
                                    const h = parseInt(a.startTime?.split(':')[0]);
                                    return h === hour;
                                });
                                return (
                                    <div key={di} style={{ borderLeft: '1px solid var(--border)', padding: '2px', position: 'relative' }}>
                                        {dayAppts.map((a, ai) => {
                                            const c = statusCalendarColors[a.status] || statusCalendarColors.pending;
                                            return (
                                                <div key={ai} style={{ fontSize: '0.68rem', padding: '2px 5px', borderRadius: '3px', background: c.bg, color: c.text, marginBottom: '2px', overflow: 'hidden' }}>
                                                    <div style={{ fontWeight: '600' }}>{a.startTime}</div>
                                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.service?.name}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}

            {/* Day detail panel */}
            {selectedDay !== null && (
                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', position: 'sticky', top: '100px' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>
                            {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                        </h3>
                        <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                    <div style={{ padding: '1rem' }}>
                        {getAppointmentsForDay(selectedDay).length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textAlign: 'center', padding: '1rem 0' }}>No appointments this day</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {getAppointmentsForDay(selectedDay)
                                    .sort((a, b) => a.startTime?.localeCompare(b.startTime))
                                    .map((a, i) => {
                                        const c = statusCalendarColors[a.status] || statusCalendarColors.pending;
                                        return (
                                            <div key={i} style={{ borderLeft: `3px solid ${c.bg}`, paddingLeft: '0.75rem', paddingTop: '0.25rem', paddingBottom: '0.25rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <div>
                                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.875rem', margin: '0 0 0.15rem' }}>{a.service?.name}</p>
                                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '0 0 0.15rem' }}>{a.customer?.name}</p>
                                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>{a.startTime} – {a.endTime}</p>
                                                    </div>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: '600', padding: '0.15rem 0.5rem', borderRadius: '99px', background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
                                                        {a.status}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                    {/* Legend */}
                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {Object.entries(statusCalendarColors).map(([status, c]) => (
                            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: c.bg }} />
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    </div>
)}
```

## Design system
- All headings: `fontFamily: 'Cormorant Garamond, serif'`
- Body font: `fontFamily: 'Outfit, sans-serif'`
- CSS variables: var(--gold), var(--charcoal), var(--border), var(--radius), var(--shadow-sm), var(--warm-gray), var(--text-muted), var(--text-secondary), var(--gold-dark)
- Cards: white background, `border: '1px solid var(--border)'`, `borderRadius: 'var(--radius)'`
- Buttons: `className="btn-primary"` or `className="btn-outline"`

## Existing appointment data shape
```json
{
  "_id": "...",
  "customer": { "name": "John", "email": "john@email.com", "phone": "..." },
  "service": { "name": "Classic Haircut", "price": 120, "duration": 30 },
  "appointmentDate": "2026-05-19T00:00:00.000Z",
  "startTime": "09:00",
  "endTime": "09:30",
  "status": "confirmed",
  "totalPrice": 120
}
```

## Status colors (existing in component)
```javascript
const statusConfig = {
    pending:   { label: 'Pending',   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: 'Confirmed', bg: '#dbeafe', color: '#1e40af' },
    completed: { label: 'Completed', bg: '#d1fae5', color: '#065f46' },
    cancelled: { label: 'Cancelled', bg: '#fee2e2', color: '#991b1b' },
};
```

## Instructions for Claude Code
1. Open `client/src/pages/ProviderDashboard.js`
2. Add the 3 state variables inside the component
3. Add the 5 helper functions inside the component
4. Add `'calendar'` to the special tabs array and label it `'📅 Calendar'`
5. Add the calendar JSX block after the earnings tab block
6. Do not change anything else in the file