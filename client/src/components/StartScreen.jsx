import GraphForm from './GraphForm';

export default function StartScreen({ form, onChange, onSubmit, loading }) {
  return (
    <div className="start-screen">
      <h1 className="start-title">Constellation.fm</h1>
      <p className="start-tagline">
        Map your listening history as a living constellation of artists.
      </p>
      <div className="panel start-card">
        <GraphForm
          form={form}
          onChange={onChange}
          onSubmit={onSubmit}
          loading={loading}
          submitLabel="Build graph"
        />
      </div>
    </div>
  );
}
