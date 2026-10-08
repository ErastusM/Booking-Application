import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewClientForm, { NewClientCard, fullPhone, phoneKey } from './NewClientForm';
import ClientPicker from './ClientPicker';

const ROSTER = [
    { customer: { _id: 'u1', name: 'Aidan Shikongo', phone: '081 630 6705' }, completedVisits: 1 },
    { customer: { _id: 'walkin:adriel', name: 'Adriel Nghifindaka', phone: null }, isWalkIn: true },
];

describe('phone helpers', () => {
    it('adds +264 to a local number and keeps a full international one', () => {
        expect(fullPhone('081 630 6705')).toBe('+264 81 630 6705');
        expect(fullPhone('+27 82 123 4567')).toBe('+27 82 123 4567');
        expect(fullPhone('0027821234567')).toBe('+27821234567');
        expect(fullPhone('')).toBe('');
    });
    it('matches a number however it was written', () => {
        expect(phoneKey('+264 81 630 6705')).toBe(phoneKey('0816306705'));
        expect(phoneKey('264816306705')).toBe(phoneKey('081 630 6705'));
        expect(phoneKey('123')).toBe('');
    });
});

describe('NewClientForm', () => {
    const setup = (props = {}) => {
        const onSave = vi.fn();
        const onPickExisting = vi.fn();
        const onBack = vi.fn();
        render(<NewClientForm initial={{ name: 'William Ritt' }} clients={ROSTER} onSave={onSave} onPickExisting={onPickExisting} onBack={onBack} {...props} />);
        return { onSave, onPickExisting, onBack };
    };

    it('prefills the name from the search and saves name, +264 phone and email', () => {
        const { onSave } = setup();
        expect(screen.getByTestId('new-client-name')).toHaveValue('William Ritt');
        fireEvent.change(screen.getByTestId('new-client-name'), { target: { value: 'William  Rittmann ' } });
        fireEvent.change(screen.getByTestId('new-client-phone'), { target: { value: '081 493 0280' } });
        fireEvent.change(screen.getByTestId('new-client-email'), { target: { value: 'w@example.com' } });
        fireEvent.click(screen.getByTestId('new-client-save'));
        expect(onSave).toHaveBeenCalledWith({ name: 'William Rittmann', phone: '+264 81 493 0280', email: 'w@example.com' });
    });

    it('needs a full name and a phone number', () => {
        const { onSave } = setup({ initial: { name: 'William' } });
        fireEvent.click(screen.getByTestId('new-client-save'));
        expect(screen.getByRole('alert')).toHaveTextContent(/first name and surname/);
        fireEvent.change(screen.getByTestId('new-client-name'), { target: { value: 'William Rittmann' } });
        fireEvent.click(screen.getByTestId('new-client-save'));
        expect(screen.getByRole('alert')).toHaveTextContent(/phone number/);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('warns when the number is already saved and offers to book that client', () => {
        const { onPickExisting, onSave } = setup();
        fireEvent.change(screen.getByTestId('new-client-phone'), { target: { value: '81 630 6705' } });
        expect(screen.getByTestId('new-client-duplicate')).toHaveTextContent('This number is already saved for Aidan Shikongo.');
        fireEvent.click(screen.getByTestId('new-client-book-existing'));
        expect(onPickExisting).toHaveBeenCalledWith(ROSTER[0]);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('goes back to the client list', () => {
        const { onBack } = setup();
        fireEvent.click(screen.getByTestId('new-client-back'));
        expect(onBack).toHaveBeenCalled();
    });
});

describe('NewClientCard', () => {
    it('shows the new client with a New tag, and Change reopens the form', () => {
        const onChange = vi.fn();
        render(<NewClientCard client={{ name: 'William Rittmann', phone: '+264 81 493 0280', email: '' }} onChange={onChange} />);
        expect(screen.getByTestId('new-client-card')).toHaveTextContent('William Rittmann');
        expect(screen.getByTestId('new-client-card')).toHaveTextContent('New');
        expect(screen.getByRole('status')).toHaveTextContent('Saved to My Clients when you book');
        fireEvent.click(screen.getByTestId('new-client-card-change'));
        expect(onChange).toHaveBeenCalled();
    });
});

describe('ClientPicker with onNewClient', () => {
    it('puts New client at the top of the list', () => {
        const onNewClient = vi.fn();
        render(<ClientPicker clients={ROSTER} value="" onChange={() => {}} onNewClient={onNewClient} />);
        fireEvent.click(screen.getByTestId('client-picker-new'));
        expect(onNewClient).toHaveBeenCalledWith('');
    });

    it('offers to add the searched name as a new client when nobody matches', () => {
        const onNewClient = vi.fn();
        render(<ClientPicker clients={ROSTER} value="" onChange={() => {}} onNewClient={onNewClient} />);
        fireEvent.change(screen.getByTestId('client-picker-search'), { target: { value: 'William Ritt' } });
        expect(screen.queryByTestId('client-picker-new')).toBeNull();
        const add = screen.getByTestId('client-picker-add-new');
        expect(add).toHaveTextContent('Add “William Ritt” as a new client');
        fireEvent.click(add);
        expect(onNewClient).toHaveBeenCalledWith('William Ritt');
    });

    it('shows New client even with no saved clients, and nothing new without the prop', () => {
        const { unmount } = render(<ClientPicker clients={[]} value="" onChange={() => {}} onNewClient={() => {}} emptyText="No saved clients yet." />);
        expect(screen.getByTestId('client-picker-new')).toBeInTheDocument();
        expect(screen.getByText('No saved clients yet.')).toBeInTheDocument();
        unmount();
        render(<ClientPicker clients={ROSTER} value="" onChange={() => {}} />);
        expect(screen.queryByTestId('client-picker-new')).toBeNull();
    });
});
