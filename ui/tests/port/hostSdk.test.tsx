/** Level-1 names are feature-detected (`src/host/hostSdk.ts`), and the shims
 * that stand where dashboard-only components stood keep their contract. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SimpleSelect from '../../src/host/SimpleSelect'
import ProjectPicker from '../../src/host/ProjectPicker'

describe('SimpleSelect over the host Select', () => {
  it("renders the host's Select at level 1", () => {
    render(<SimpleSelect aria-label="Pick" options={['a', 'b']} value="a" onChange={() => {}} />)
    expect(screen.getByLabelText('Pick')).toHaveAttribute('data-host-select')
  })

  it('applies a style through a wrapper, since the host Select takes none', () => {
    const { container } = render(
      <SimpleSelect aria-label="Pick" options={['a']} value="a" onChange={() => {}} style={{ flexShrink: 0 }} />,
    )
    expect((container.firstChild as HTMLElement).style.flexShrink).toBe('0')
  })
})

describe('on a host without the level-1 Select', () => {
  it('falls back to a native select with the same props', async () => {
    vi.resetModules()
    vi.doMock('@kirocrew/app-sdk/ui', async () => {
      const real = await vi.importActual<Record<string, unknown>>('../stubs/app-sdk-ui')
      const { Select: _drop, ...rest } = real
      return rest
    })
    const { Select } = await import('../../src/host/hostSdk')
    const onChange = vi.fn()
    render(<Select aria-label="Old" options={['x', 'y']} value="x" onChange={onChange} />)
    const el = screen.getByLabelText('Old')
    expect(el).not.toHaveAttribute('data-host-select')
    fireEvent.change(el, { target: { value: 'y' } })
    expect(onChange).toHaveBeenCalledWith('y')
    vi.doUnmock('@kirocrew/app-sdk/ui')
  })
})

describe('ProjectPicker', () => {
  it('starts from the saved path and hands back the typed one', () => {
    const onSelect = vi.fn()
    render(<ProjectPicker open onOpenChange={() => {}} startPath="/srv/clone" onSelect={onSelect} />)
    const input = screen.getByRole('textbox', { name: 'Working copy folder' })
    expect(input).toHaveValue('/srv/clone')
    fireEvent.change(input, { target: { value: '  /srv/other  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
    expect(onSelect).toHaveBeenCalledWith('/srv/other')
  })

  it('cannot pick an empty path, and Cancel closes', () => {
    const onOpenChange = vi.fn()
    render(<ProjectPicker open onOpenChange={onOpenChange} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing while closed', () => {
    render(<ProjectPicker open={false} onOpenChange={() => {}} onSelect={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
