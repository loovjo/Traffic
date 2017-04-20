let http = require("http")
let fs = require("fs")
let timers = require("timers")

halfCarHeight = 50
halfCarWidth = halfCarHeight / 2

FORWARD = 0
BACKWARD = 1

traffic = {
    cars: [
        {name: "Car1", pos: {x:10, y:5}, rot: 180, vel: 1, steering: 0, ai: {onRoad: 0, direction: FORWARD}}, 
        {name: "Car2", pos: {x:15, y:15}, rot: 0, vel: 1, steering: -50, ai: {onRoad: 0, direction: BACKWARD}}
    ],
    roads: [
        {start: {x: 7, y: 5}, end: {x: 20, y: 10}, startRoadIdx: -1, endRoadIdx: -1}
    ]
}

lastTime = Date.now()

toRadians = (theta => theta * Math.PI / 180)
toDegrees = (theta => theta * 180 / Math.PI)

var physics = timers.setInterval(() => {
    delta = (Date.now() - lastTime) / 1000
    lastTime = Date.now()
    traffic.cars = traffic.cars.map(car => {
        theta = toRadians(car.rot)
        rx = Math.cos(theta) * delta * car.vel
        ry = Math.sin(theta) * delta * car.vel
        new_pos = {x: car.pos.x + rx, y: car.pos.y + ry}
        car.pos = new_pos

        car.rot += car.steering * delta

        // Calculate AI
        if (car.ai) {
            road = traffic.roads[car.ai.onRoad]
            road_delta = {x: road.end.x - road.start.x, y: road.end.y - road.start.y}
            road_rot = toDegrees(Math.atan2(road_delta.y, road_delta.x))

            k = road_delta.y / road_delta.x
            m = road.start.y - k * road.start.x

            cx = (car.pos.x + k * car.pos.y - k * m) / (1 + k * k)
            cy = k * cx + m
            dx = car.pos.x - cx
            dy = car.pos.y - cy
            dist = Math.pow(dx * dx + dy * dy, 1/4)

            // Steer car towards closest point
            wanted_end_pos = car.ai.direction == FORWARD ? road.end : road.start
            
            wanted_rot = (toDegrees(Math.atan2(car.pos.y - (cy * dist + wanted_end_pos.y) / (dist + 1), car.pos.x - (cx * dist + wanted_end_pos.x) / (dist + 1)))) % 360 + 180

            car.steering = wanted_rot - car.rot
            
            car.steering = (car.steering + 180) % 360 - 180
        }
        return car
    })
}, 20)

var server = http.createServer((req, res) => {
    method = req.method
    url = req.url
    if (method == "GET") {
        filePath = "Web" + url
        if (url === "/Cars") {
            res.setHeader("Content-Type", "text/json")
            res.end(JSON.stringify(traffic))
        } else if (fs.existsSync(filePath)) {
            console.log(method + " " + url)
            if (!fs.lstatSync(filePath).isFile()) {
                filePath = "Web/index.html"
            }
            content = fs.readFileSync(filePath)
            res.setHeader("Content-Type", "text/html")
            res.end(content)
        }
    }
    else
        res.end("Hello!")
})

server.listen(8000)