import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

const Breadcrumbs = () => {
  const location = useLocation()
  
  // Define breadcrumb mappings
  const breadcrumbMap = {
    '/': { name: 'Dashboard', icon: Home },
    '/dashboard': { name: 'Dashboard', icon: Home },
    '/settings': { name: 'Settings' },
    '/tasks': { name: 'Tasks' },
    '/team': { name: 'Team' }
  }

  // Generate breadcrumb items
  const generateBreadcrumbs = () => {
    const pathSegments = location.pathname.split('/').filter(segment => segment)
    const breadcrumbs = []

    // Always start with Dashboard
    breadcrumbs.push({
      name: 'Dashboard',
      path: '/',
      icon: Home,
      isLast: pathSegments.length === 0 || location.pathname === '/dashboard'
    })

    // Add additional segments
    let currentPath = ''
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`
      const breadcrumbInfo = breadcrumbMap[currentPath]
      
      if (breadcrumbInfo && currentPath !== '/') {
        breadcrumbs.push({
          name: breadcrumbInfo.name,
          path: currentPath,
          icon: breadcrumbInfo.icon,
          isLast: index === pathSegments.length - 1
        })
      }
    })

    return breadcrumbs
  }

  const breadcrumbs = generateBreadcrumbs()

  // Don't show breadcrumbs if we're just on the dashboard
  if (breadcrumbs.length <= 1) {
    return null
  }

  return (
    <nav className="bg-gray-50 border-b border-gray-200">
      <div className="container mx-auto px-6 py-3">
        <ol className="flex items-center space-x-2 text-sm">
          {breadcrumbs.map((breadcrumb, index) => {
            const Icon = breadcrumb.icon
            
            return (
              <li key={breadcrumb.path} className="flex items-center">
                {index > 0 && (
                  <ChevronRight className="w-4 h-4 text-gray-400 mr-2" />
                )}
                
                {breadcrumb.isLast ? (
                  <span className="flex items-center text-gray-900 font-medium">
                    {Icon && <Icon className="w-4 h-4 mr-1" />}
                    {breadcrumb.name}
                  </span>
                ) : (
                  <Link
                    to={breadcrumb.path}
                    className="flex items-center text-gray-600 hover:text-primary transition-colors duration-200"
                  >
                    {Icon && <Icon className="w-4 h-4 mr-1" />}
                    {breadcrumb.name}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}

export default Breadcrumbs