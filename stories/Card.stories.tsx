import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardHeader } from '../components/ui/Card';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Kartentitel</h3>
      </CardHeader>
      <CardContent>
        <p>Karteninhalt mit etwas Text.</p>
      </CardContent>
    </Card>
  ),
};

export const Interactive: Story = {
  render: () => (
    <Card as="button" onClick={() => alert('Geklickt!')}>
      <CardContent>
        <p>Klickbare Karte</p>
      </CardContent>
    </Card>
  ),
};
