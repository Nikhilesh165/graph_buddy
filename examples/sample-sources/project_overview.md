# Solstice Robotics -- Product Portfolio

Solstice Robotics is an agtech startup founded in 2021 and headquartered in
Austin, Texas, with a field office in Des Moines, Iowa. The company builds
autonomous drones and coordination software for row-crop farming.

## Project Meridian

Project Meridian is Solstice's flagship product: an autonomous crop-scouting
drone that flies pre-programmed field patterns, captures multispectral
imagery, and flags crop stress before it's visible to the naked eye.

- **Team lead:** Priya Nair (VP of Engineering)
- **Firmware:** Sam Whitfield
- **Airframe & hardware:** Lena Kowalski
- **Field applications:** Jordan Blake
- **Status:** in pilot with GreenField Farms (Iowa), a family-owned row-crop
  operation and Solstice's first paying customer.
- **Tech stack:** custom flight controller firmware (C++), multispectral
  camera payload, on-device inference for stress detection, cloud dashboard
  for agronomists.

## Project Halcyon

Project Halcyon is Solstice's swarm-coordination platform, allowing multiple
Meridian drones to cover large fields cooperatively without duplicating
flight paths.

- **Team lead:** David Okoye (CTO)
- **Algorithms & modeling:** Ravi Subramaniam (Data Scientist)
- **Status:** proof-of-concept completed with AgriNova Cooperative
  (Nebraska), a multi-farm grain cooperative; general availability targeted
  for Q4.
- **Tech stack:** distributed pathing algorithm, ROS 2 messaging layer,
  telemetry pipeline feeding the same cloud dashboard used by Project
  Meridian.

## Customers

| Customer               | Location | Project   | Relationship          |
|-------------------------|----------|-----------|------------------------|
| GreenField Farms         | Iowa     | Meridian  | Paying pilot customer  |
| AgriNova Cooperative     | Nebraska | Halcyon   | Proof-of-concept partner |

## Funding

Solstice Robotics closed a $12M Series A in January 2023 led by Terra
Ventures, with participation from AgFirst Capital. The company is targeting
a Series B in early 2027 to fund Project Halcyon's general-availability
launch.
