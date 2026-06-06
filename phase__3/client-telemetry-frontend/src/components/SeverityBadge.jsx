// src/components/SeverityBadge.jsx

export default function SeverityBadge({ severity }) {
  const getStyle = () => {
    switch (severity) {
      case "HIGH":
        return {
          backgroundColor: "#fdecea",
          color: "#b71c1c",
          border: "1px solid #f5c6cb",
        };
      case "MEDIUM":
        return {
          backgroundColor: "#fff4e5",
          color: "#e65100",
          border: "1px solid #ffe0b2",
        };
      case "LOW":
        return {
          backgroundColor: "#e8f5e9",
          color: "#1b5e20",
          border: "1px solid #c8e6c9",
        };
      default:
        return {
          backgroundColor: "#eeeeee",
          color: "#424242",
          border: "1px solid #cccccc",
        };
    }
  };

  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "12px",
        fontSize: "13px",
        fontWeight: "700",
        display: "inline-block",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        ...getStyle(),
      }}
    >
      {severity}
    </span>
  );
}
