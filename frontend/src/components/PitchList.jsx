export default function PitchList({ pitches }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
      {pitches.map(pitch => (
        <div key={pitch.id} style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: '8px', background: 'white' }}>
          <h3>{pitch.title}</h3>
          <p>{pitch.description}</p>
          <span style={{ background: '#e0e0e0', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '12px' }}>{pitch.category}</span>
        </div>
      ))}
    </div>
  )
}
