/**
 * The dashboard's tabs (`components/ui/tabs.tsx`) over the same Radix primitive
 * with the same classes and the same sliding pill, minus the guide's probe and
 * reveal-scope hooks.
 */
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from './cn'
import {
  TABS_COUNT_BASE_CLASS,
  TABS_INDICATOR_CLASS,
  TABS_INDICATOR_SPRING,
  TABS_SEGMENT_CLASS,
  TABS_SEGMENT_DISABLED_ARIA_CLASS,
  TABS_TRACK_CLASS,
} from './tabsPill'

interface TabsValue {
  current?: string
  layoutId: string
}

const TabsValueContext = React.createContext<TabsValue | null>(null)

interface TabsProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  layoutId?: string
  guideProbe?: 'local'
}

const Tabs = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function Tabs({ layoutId = 'tabs-indicator', value, defaultValue, onValueChange, guideProbe: _probe, ...props }, ref) {
    const [internal, setInternal] = React.useState(value ?? defaultValue)
    const current = value ?? internal
    const handleValueChange = React.useCallback((next: string) => {
      setInternal(next)
      onValueChange?.(next)
    }, [onValueChange])
    const ctx = React.useMemo(() => ({ current, layoutId }), [current, layoutId])
    return (
      <TabsValueContext.Provider value={ctx}>
        <TabsPrimitive.Root ref={ref} value={current} onValueChange={handleValueChange} {...props} />
      </TabsValueContext.Provider>
    )
  },
)
Tabs.displayName = TabsPrimitive.Root.displayName

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return <TabsPrimitive.List ref={ref} className={cn(TABS_TRACK_CLASS, className)} {...props} />
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, children, value, ...props }, ref) {
  const ctx = React.useContext(TabsValueContext)
  const reduceMotion = useReducedMotion()
  const isActive = ctx?.current === value
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(TABS_SEGMENT_CLASS, 'data-[state=active]:text-accent', TABS_SEGMENT_DISABLED_ARIA_CLASS, className)}
      {...props}
    >
      {isActive && (reduceMotion
        ? <span aria-hidden="true" className={TABS_INDICATOR_CLASS} />
        : <motion.span layoutId={ctx?.layoutId} aria-hidden="true" className={TABS_INDICATOR_CLASS} transition={TABS_INDICATOR_SPRING} />
      )}
      {children}
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & { guideScope?: string }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
>(function TabsContent({ className, guideScope: _scope, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('focus-visible:outline-hidden', className)} {...props} />
})
TabsContent.displayName = TabsPrimitive.Content.displayName

function TabsCount({ value }: { value?: number }) {
  if ((value ?? 0) <= 0) return null
  return (
    <span className={cn(TABS_COUNT_BASE_CLASS, 'text-muted/40 group-data-[state=active]/tab:text-accent/60')}>
      {value}
    </span>
  )
}

export interface TabItem<T extends string = string> {
  key: T
  label: string
  icon?: React.ReactNode
  count?: number
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsCount }
